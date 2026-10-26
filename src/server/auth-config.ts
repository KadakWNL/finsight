import 'server-only';
import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { revokeSession, validateSession } from './session';
import { signInWithCredentials } from './authentication';
import { getAuthSecret, sessionCookieName, sessionCookieOptions } from './auth-security';

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'text' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const result = await signInWithCredentials(credentials.email, credentials.password);
        if (!result) return null;
        return {
          id: result.user.userId,
          sessionId: result.session.sessionId,
        };
      },
    }),
  ],
  session: {
    strategy: 'jwt',
    maxAge: 8 * 60 * 60, // 8 hours absolute
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        return { sub: user.id, sid: (user as unknown as { sessionId: string }).sessionId };
      }
      return token;
    },
    async session({ session, token }) {
      if (typeof token.sid !== 'string' || typeof token.sub !== 'string') throw new Error('Session unavailable');
      const validation = await validateSession(token.sid, undefined, token.sub);
      if (!validation.valid) throw new Error('Session unavailable');
      return { ...session, expires: validation.session.absoluteExpiresAt,
        user: { ...validation.user, id: validation.user.userId, name: validation.user.displayName } };
    },
  },
  events: {
    async signOut({ token }) {
      if (token?.sid && typeof token.sid === 'string') {
        await revokeSession(token.sid, 'sign_out');
      }
    },
  },
  pages: {
    signIn: '/login',
  },
  cookies: { sessionToken: { name: sessionCookieName(), options: sessionCookieOptions() } },
  get secret() { return getAuthSecret(); },
};
