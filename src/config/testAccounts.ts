// Test accounts for quick user switching during development.
//
// Real values live in EXPO_PUBLIC_TEST_ACCOUNTS_JSON, a local var in your
// gitignored .env — never edit this file to add credentials. This file is
// tracked in git and must stay empty-by-default: a clean checkout (or an
// EAS cloud build, which never has that var set) then simply gets no test
// accounts instead of a hard Metro bundling failure — see .env.example.
type TestAccount = { label: string; email: string; password: string };

const raw = process.env.EXPO_PUBLIC_TEST_ACCOUNTS_JSON;
export const TEST_ACCOUNTS: TestAccount[] = raw ? JSON.parse(raw) : [];
