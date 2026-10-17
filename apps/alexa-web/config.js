/**
 * Popcorn AI — Voice Page Configuration & Constants
 * Overridable via URL query parameters:
 *   ?agent=http://127.0.0.1:8100
 *   ?tv=http://127.0.0.1:8000/api/state
 *   ?mock=1
 */

const params = new URLSearchParams(window.location.search);

export const AGENT_URL = (params.get("agent") || "http://127.0.0.1:8100").replace(/\/+$/, "");
export const TV_STATE_URL = params.get("tv") || "http://127.0.0.1:8000/api/state";
export const MOCK_MODE = params.get("mock") === "1" || params.get("mock") === "true";
export const INITIAL_ORB_STATE = params.get("state") || "idle";

export const TV_POLL_INTERVAL_MS = 1500;
export const STORAGE_KEY_SPEAKER = "popcorn_ai_speaker";

/**
 * Friendly human-readable labels for the 10 MCP tools in "Agent at work".
 */
export const TOOL_LABELS = {
  set_couch: "Updating the couch",
  add_to_couch: "Adding to the couch",
  remove_from_couch: "Removing from the couch",
  get_profiles: "Checking taste profiles",
  update_taste: "Saving taste preferences",
  start_duel: "Starting poster duel on TV",
  record_duel_choice: "Recording poster duel pick",
  recommend_for_couch: "Finding movies for everyone",
  mark_watched: "Saving watched movie",
  get_movie_details: "Loading movie details on TV",
};

/**
 * Format tool input object into a concise subtitle for the "Agent at work" panel.
 */
export function formatToolInput(tool, input) {
  if (!input || typeof input !== "object") return "";
  switch (tool) {
    case "set_couch": {
      if (Array.isArray(input.people) && input.people.length > 0) {
        return input.people
          .map((p) => {
            if (typeof p === "string") return p;
            const kidTag = p.kid || (typeof p.age === "number" && p.age < 13) ? " (kid)" : "";
            return `${p.name || "Guest"}${kidTag}`;
          })
          .join(", ");
      }
      return "";
    }
    case "add_to_couch": {
      if (!input.name) return "";
      const suffix = input.age ? ` (age ${input.age})` : input.kid ? " (kid)" : "";
      return `${input.name}${suffix}`;
    }
    case "remove_from_couch":
      return input.name || "";
    case "get_profiles":
      return Array.isArray(input.names) && input.names.length > 0
        ? input.names.join(", ")
        : "Full household";
    case "update_taste": {
      const parts = [];
      if (input.name) parts.push(input.name);
      if (Array.isArray(input.loves) && input.loves.length) parts.push(`loves ${input.loves.join(", ")}`);
      if (Array.isArray(input.likes) && input.likes.length) parts.push(`likes ${input.likes.join(", ")}`);
      if (Array.isArray(input.dislikes) && input.dislikes.length) parts.push(`dislikes ${input.dislikes.join(", ")}`);
      if (Array.isArray(input.hates) && input.hates.length) parts.push(`hates ${input.hates.join(", ")}`);
      return parts.join(" · ");
    }
    case "start_duel":
      return input.name ? `${input.name} (${input.rounds || 5} rounds)` : "";
    case "record_duel_choice":
      return input.pick ? `Picked ${input.pick} poster` : "";
    case "recommend_for_couch": {
      if (Array.isArray(input.boost_genres) && input.boost_genres.length > 0) {
        return `Mood: ${input.boost_genres.join(", ")}`;
      }
      return "Group taste match";
    }
    case "mark_watched":
      return input.movie || "";
    case "get_movie_details":
      return input.movie || "";
    default: {
      const entries = Object.entries(input).slice(0, 2);
      return entries.map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(", ");
    }
  }
}

/**
 * Strip leading wake words: "alexa", "hey popcorn", "popcorn" (case-insensitive, optional comma/punctuation).
 */
export function stripWakeWord(rawText) {
  if (!rawText || typeof rawText !== "string") return "";
  return rawText
    .replace(/^\s*(?:(?:hey\s+popcorn|popcorn|alexa)\b[\s,:.;!-]*)+/i, "")
    .trim();
}

/**
 * Deterministic warm cinema avatar color from a person's name (matches tokens.css --color-avatar-0..7).
 */
export const AVATAR_COLORS = [
  "#C85A32",
  "#B87D28",
  "#8E4A49",
  "#5C7A52",
  "#9E6240",
  "#7A5475",
  "#A8423F",
  "#6F6A42",
];

export function avatarColorForName(name) {
  const clean = (name || "Guest").trim().toLowerCase();
  let hash = 0;
  for (let i = 0; i < clean.length; i += 1) {
    hash = (hash * 31 + clean.charCodeAt(i)) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

export function initialsForName(name) {
  const parts = (name || "?").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
