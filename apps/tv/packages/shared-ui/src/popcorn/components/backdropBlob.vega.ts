import { API_BASE_URL } from '../config';

// Vega cannot load images bundled from this shared package ("Unknown URL scheme" crash),
// so the Vega build loads the same file over HTTPS from the server.
export const BLOB = { uri: `${API_BASE_URL}/static/backdrop-blob.png` };
