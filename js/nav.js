// Tiny navigation hook so modules can switch tabs without importing app.js (avoids import cycles).
export const nav = { go: (_tab) => {}, current: () => '' };
