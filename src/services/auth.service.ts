import { supabase } from './supabase';
import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import type { Session } from '@supabase/supabase-js';

WebBrowser.maybeCompleteAuthSession();

export async function signInWithGoogle() {
  const redirectUrl = AuthSession.makeRedirectUri({ scheme: 'useit' });

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: redirectUrl,
      skipBrowserRedirect: true,
      queryParams: {
        access_type: 'offline',
        prompt: 'consent',
      },
    },
  });

  if (error) throw error;

  if (data?.url) {
    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectUrl);

    if (result.type === 'success' && result.url) {
      const url = result.url;
      const hashOrQuery = url.includes('#') ? url.split('#')[1] : url.split('?')[1];
      const params = Object.fromEntries(new URLSearchParams(hashOrQuery ?? ''));
      const { access_token, refresh_token } = params;

      if (access_token && refresh_token) {
        await supabase.auth.setSession({ access_token, refresh_token });
      }
    }
  }
}

// Apple guideline 4.8: required once a third-party login (Google) exists.
// NOT functional yet — Supabase's Apple OAuth provider needs a paid Apple
// Developer Program Services ID/Team ID/Key, which the free personal team
// can't create; see NEXT_STEP.md. Uses Apple's native sign-in sheet (their
// own guidelines require this over a generic web OAuth redirect on iOS,
// unlike Google above) with a SHA-256-hashed nonce so Supabase can verify
// the identity token was actually requested by this exact sign-in attempt.
export async function signInWithApple() {
  const rawNonce = Crypto.randomUUID();
  const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);

  const credential = await AppleAuthentication.signInAsync({
    requestedScopes: [
      AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
      AppleAuthentication.AppleAuthenticationScope.EMAIL,
    ],
    nonce: hashedNonce,
  });

  if (!credential.identityToken) throw new Error('Apple did not return an identity token');

  const { error } = await supabase.auth.signInWithIdToken({
    provider: 'apple',
    token: credential.identityToken,
    nonce: rawNonce,
  });
  if (error) throw error;
}

export async function signInWithEmail(email: string, password: string) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function signUpWithEmail(email: string, password: string) {
  const { error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export function getCurrentUser() {
  return supabase.auth.getUser();
}

export function onAuthStateChange(callback: (session: Session | null) => void) {
  return supabase.auth.onAuthStateChange((_event, session) => {
    callback(session);
  });
}
