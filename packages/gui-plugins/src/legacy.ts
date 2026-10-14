/**
 * Earlier ids of renamed built-ins, newest first, by current id. Both hosts read them to keep a user's enable setting
 * across the rename; each built-in's stores, commands and panels migrate on their own (`from`, the keybind rename map,
 * `Panel.legacy`).
 */
export const legacy = {
  context: ["usage"],
  details: ["summary"],
}
