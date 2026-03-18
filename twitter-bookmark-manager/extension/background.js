/**
 * Background service worker for Twitter/X Bookmark Manager extension.
 * Handles auth token storage, bookmark parsing, direct API fetching, and periodic sync.
 */

// ========== Default GraphQL configuration ==========
const DEFAULT_QUERY_ID = 'u0Jgx3Gl2k9SeaIUCHSU-Q';
const DEFAULT_FEATURES = {
  graphql_timeline_v2_bookmark_timeline: true,
  responsive_web_graphql_exclude_directive_enabled: true,
  verified_phone_label_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  tweetypie_unmention_optimization_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  tweet_awards_web_tipping_enabled: false,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  rweb_video_timestamps_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: true,
  responsive_web_enhance_cards_enabled: false,
};

const REQUESTS_PER_PAGE = 100;
const DELAY_BETWEEN_REQUESTS_MS = 300;
const SYNC_ALARM_NAME = 'periodic-bookmark-sync';
const SYNC_INTERVAL_MINUTES = 15;

// ========== Sync status tracking ==========
let syncStatus = {
  inProgress: false,
  progress: 0,
  total: 0,
  message: 'Idle',
  lastError: null,
};

// ========== Utility: sleep ==========
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ========== Parse a tweet result into our Bookmark format ==========
function parseTweetResult(result) {
  if (!result) return null;

  // Handle tweet with visibility results wrapper
  const tweet = result.__typename === 'TweetWithVisibilityResults'
    ? result.tweet
    : result;

  if (!tweet || !tweet.legacy) return null;

  const legacy = tweet.legacy;
  const userResult = tweet.core?.user_results?.result;
  const userLegacy = userResult?.legacy;

  if (!userLegacy) return null;

  // Extract media URLs
  const mediaUrls = [];
  if (legacy.extended_entities?.media) {
    for (const media of legacy.extended_entities.media) {
      if (media.type === 'video' || media.type === 'animated_gif') {
        // Get highest bitrate video variant
        const variants = media.video_info?.variants || [];
        const mp4Variants = variants.filter((v) => v.content_type === 'video/mp4');
        mp4Variants.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
        if (mp4Variants.length > 0) {
          mediaUrls.push(mp4Variants[0].url);
        } else if (media.media_url_https) {
          mediaUrls.push(media.media_url_https);
        }
      } else {
        if (media.media_url_https) {
          mediaUrls.push(media.media_url_https);
        }
      }
    }
  }

  const now = new Date().toISOString();
  const tweetId = tweet.rest_id || legacy.id_str;
  const screenName = userLegacy.screen_name;

  return {
    id: tweetId,
    text: legacy.full_text || '',
    authorName: userLegacy.name || '',
    authorHandle: screenName || '',
    authorAvatar: userLegacy.profile_image_url_https || '',
    createdAt: legacy.created_at
      ? new Date(legacy.created_at).toISOString()
      : now,
    bookmarkedAt: now,
    mediaUrls,
    tags: [],
    url: `https://x.com/${screenName}/status/${tweetId}`,
    isRemoved: false,
    lastModified: now,
  };
}

// ========== Parse bookmark timeline response into Bookmark[] ==========
function parseBookmarksResponse(data) {
  const bookmarks = [];
  let bottomCursor = null;

  try {
    const instructions =
      data?.data?.bookmark_timeline_v2?.timeline?.instructions || [];

    for (const instruction of instructions) {
      const entries = instruction.entries || [];

      for (const entry of entries) {
        // Tweet entries
        if (entry.entryId && entry.entryId.startsWith('tweet-')) {
          const tweetResult =
            entry.content?.itemContent?.tweet_results?.result;
          const bookmark = parseTweetResult(tweetResult);
          if (bookmark) {
            bookmarks.push(bookmark);
          }
        }

        // Cursor entries
        if (
          entry.entryId &&
          entry.entryId.startsWith('cursor-bottom-')
        ) {
          bottomCursor = entry.content?.value;
        }
      }
    }
  } catch (e) {
    console.error('[TBM] Error parsing bookmarks response:', e);
  }

  return { bookmarks, bottomCursor };
}

// ========== Fetch all bookmarks via Twitter GraphQL API ==========
async function fetchAllBookmarks() {
  if (syncStatus.inProgress) {
    return { success: false, error: 'Sync already in progress' };
  }

  syncStatus = {
    inProgress: true,
    progress: 0,
    total: 0,
    message: 'Starting sync...',
    lastError: null,
  };

  try {
    // Retrieve stored auth tokens and query info
    const stored = await chrome.storage.local.get([
      'authTokens',
      'bookmarksQueryId',
      'bookmarksFeatures',
    ]);

    const { authTokens } = stored;
    if (!authTokens?.bearerToken || !authTokens?.csrfToken) {
      throw new Error(
        'Missing auth tokens. Please visit x.com/i/bookmarks first to capture credentials.'
      );
    }

    const queryId = stored.bookmarksQueryId || DEFAULT_QUERY_ID;
    const features = stored.bookmarksFeatures || DEFAULT_FEATURES;

    const allBookmarks = [];
    let cursor = null;
    let hasMore = true;
    let page = 0;

    while (hasMore) {
      page++;
      syncStatus.message = `Fetching page ${page}...`;
      syncStatus.progress = allBookmarks.length;

      // Build variables
      const variables = {
        count: REQUESTS_PER_PAGE,
        includePromotedContent: false,
      };
      if (cursor) {
        variables.cursor = cursor;
      }

      // Build URL
      const url =
        `https://x.com/i/api/graphql/${queryId}/Bookmarks` +
        `?variables=${encodeURIComponent(JSON.stringify(variables))}` +
        `&features=${encodeURIComponent(JSON.stringify(features))}`;

      // Make the request
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          authorization: authTokens.bearerToken,
          'x-csrf-token': authTokens.csrfToken,
          'x-twitter-active-user': 'yes',
          'x-twitter-auth-type': 'OAuth2Session',
          'x-twitter-client-language': 'en',
          'content-type': 'application/json',
        },
        credentials: 'include',
      });

      if (!response.ok) {
        if (response.status === 429) {
          syncStatus.message = 'Rate limited. Waiting 60s...';
          await sleep(60000);
          continue;
        }
        throw new Error(`API request failed with status ${response.status}`);
      }

      const data = await response.json();
      const { bookmarks, bottomCursor } = parseBookmarksResponse(data);

      allBookmarks.push(...bookmarks);
      syncStatus.progress = allBookmarks.length;
      syncStatus.total = allBookmarks.length;

      if (bottomCursor && bookmarks.length > 0) {
        cursor = bottomCursor;
        await sleep(DELAY_BETWEEN_REQUESTS_MS);
      } else {
        hasMore = false;
      }
    }

    // Merge with existing bookmarks (preserve tags and bookmarkedAt for known IDs)
    const existingData = await chrome.storage.local.get(['bookmarks']);
    const existingBookmarks = existingData.bookmarks || [];
    const existingMap = new Map(existingBookmarks.map((b) => [b.id, b]));

    const mergedBookmarks = allBookmarks.map((newB) => {
      const existing = existingMap.get(newB.id);
      if (existing) {
        return {
          ...newB,
          tags: existing.tags || [],
          bookmarkedAt: existing.bookmarkedAt || newB.bookmarkedAt,
          lastModified: new Date().toISOString(),
        };
      }
      return newB;
    });

    // Mark bookmarks no longer in the API response as removed
    const fetchedIds = new Set(allBookmarks.map((b) => b.id));
    for (const existing of existingBookmarks) {
      if (!fetchedIds.has(existing.id) && !existing.isRemoved) {
        mergedBookmarks.push({
          ...existing,
          isRemoved: true,
          lastModified: new Date().toISOString(),
        });
      } else if (!fetchedIds.has(existing.id) && existing.isRemoved) {
        mergedBookmarks.push(existing);
      }
    }

    // Store
    await chrome.storage.local.set({
      bookmarks: mergedBookmarks,
      lastSyncedAt: new Date().toISOString(),
    });

    syncStatus = {
      inProgress: false,
      progress: mergedBookmarks.length,
      total: mergedBookmarks.length,
      message: `Synced ${allBookmarks.length} bookmarks`,
      lastError: null,
    };

    return { success: true, count: allBookmarks.length };
  } catch (error) {
    syncStatus = {
      inProgress: false,
      progress: 0,
      total: 0,
      message: `Error: ${error.message}`,
      lastError: error.message,
    };
    return { success: false, error: error.message };
  }
}

// ========== Message handling ==========
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.source && message.source !== 'tbm-interceptor') return;

  switch (message.type) {
    case 'AUTH_TOKENS': {
      // Merge with existing tokens
      chrome.storage.local.get(['authTokens'], (result) => {
        const existing = result.authTokens || {};
        const updated = { ...existing, ...message.tokens };
        chrome.storage.local.set({ authTokens: updated });
      });
      break;
    }

    case 'BOOKMARKS_DATA': {
      // Parse and store bookmarks captured via interception
      const { bookmarks } = parseBookmarksResponse(message.data);
      if (bookmarks.length > 0) {
        chrome.storage.local.get(['bookmarks'], (result) => {
          const existing = result.bookmarks || [];
          const existingMap = new Map(existing.map((b) => [b.id, b]));

          for (const newB of bookmarks) {
            const old = existingMap.get(newB.id);
            if (old) {
              existingMap.set(newB.id, {
                ...newB,
                tags: old.tags || [],
                bookmarkedAt: old.bookmarkedAt || newB.bookmarkedAt,
                lastModified: new Date().toISOString(),
              });
            } else {
              existingMap.set(newB.id, newB);
            }
          }

          chrome.storage.local.set({
            bookmarks: Array.from(existingMap.values()),
          });
        });
      }
      break;
    }

    case 'BOOKMARKS_QUERY_INFO': {
      // Store the queryId and features for direct API calls
      const updates = {};
      if (message.queryId) updates.bookmarksQueryId = message.queryId;
      if (message.features) updates.bookmarksFeatures = message.features;
      chrome.storage.local.set(updates);
      break;
    }

    case 'BOOKMARK_ACTION': {
      // A bookmark was added or removed by the user
      console.log(`[TBM] Bookmark ${message.action}: ${message.url}`);
      break;
    }

    // Messages from popup
    case 'TRIGGER_SYNC': {
      fetchAllBookmarks().then((result) => {
        sendResponse(result);
      });
      return true; // keep channel open for async response
    }

    case 'GET_STATUS': {
      chrome.storage.local.get(['bookmarks', 'lastSyncedAt'], (result) => {
        sendResponse({
          syncStatus,
          bookmarkCount: (result.bookmarks || []).length,
          lastSyncedAt: result.lastSyncedAt || null,
        });
      });
      return true; // keep channel open for async response
    }

    case 'EXPORT_BOOKMARKS': {
      chrome.storage.local.get(['bookmarks', 'lastSyncedAt'], (result) => {
        sendResponse({
          bookmarks: result.bookmarks || [],
          lastSyncedAt: result.lastSyncedAt || null,
          exportedAt: new Date().toISOString(),
          version: 1,
        });
      });
      return true;
    }
  }
});

// ========== Periodic sync alarm ==========
chrome.alarms.create(SYNC_ALARM_NAME, {
  periodInMinutes: SYNC_INTERVAL_MINUTES,
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SYNC_ALARM_NAME) {
    // Only auto-sync if we have auth tokens
    chrome.storage.local.get(['authTokens'], (result) => {
      if (result.authTokens?.bearerToken && result.authTokens?.csrfToken) {
        fetchAllBookmarks();
      }
    });
  }
});

// Log when service worker starts
console.log('[TBM] Background service worker started');
