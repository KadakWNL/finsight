import 'server-only';
import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { validateCredentials } from './auth';
import { createSession, revokeSession } from './session';

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

        const authResult = await validateCredentials(credentials.email, credentials.password);
        if (!authResult.ok) {
          return null;
        }

        const sessionRecord = await createSession(authResult.user.userId);
        return {
          id: authResult.user.userId,
          email: authResult.user.email,
          name: authResult.user.displayName,
          role: authResult.user.role,
          sessionId: sessionRecord.sessionId,
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
        token.sub = user.id;
        token.sid = (user as unknown as { sessionId: string }).sessionId;
      }
      return token;
    },
    async session({ session, token }) {
      if (token && session.user) {
        (session.user as unknown as { id: string }).id = token.sub as string;
        (session as unknown as { sessionId: string }).sessionId = token.sid as string;
      }
      return session;
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
  secret: process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET || 'dev-fallback-secret-minimum-32-chars-long!!',
};
