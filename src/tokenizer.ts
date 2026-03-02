// Strip Discord-specific formatting, URLs, emoji, then tokenize into words.

// Matches <@userid>, <#channelid>, <:emoji:id>, <a:emoji:id>, etc.
const DISCORD_MENTION = /<(@[!&]?|#|a?:[a-zA-Z0-9_]+:)\d*>/g;
// Matches URLs
const URL_PATTERN = /https?:\/\/\S+/g;
// Matches emoji shortcodes like :smile:
const EMOJI_SHORTCODE = /:[a-zA-Z0-9_+-]+:/g;
// Matches unicode emoji (basic range)
const UNICODE_EMOJI = /\p{Extended_Pictographic}/gu;

export const tokenize = (content: string): string[] => {
  const text = content
    .replace(DISCORD_MENTION, " ")
    .replace(URL_PATTERN, " ")
    .replace(EMOJI_SHORTCODE, " ")
    .replace(UNICODE_EMOJI, " ")
    // Strip markdown-ish formatting characters
    .replace(/[*_~`|>]/g, " ")
    // Lowercase
    .toLowerCase();

  // Split on anything that's not a Unicode letter or apostrophe
  const tokens = text.split(/[^\p{L}']+/u);

  return tokens.flatMap((t) => {
    const word = t.replace(/^'+|'+$/g, "");
    return word.length >= 2 && !/^\d+$/.test(word) ? [word] : [];
  });
};
