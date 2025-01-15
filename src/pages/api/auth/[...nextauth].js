import NextAuth from "next-auth";
import GoogleProvider from "next-auth/providers/google";

export const authOptions = {
    providers: [
        GoogleProvider({
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            authorization: {
                params: {
                    scope: "https://www.googleapis.com/auth/drive.file openid email profile",
                    prompt: "consent",
                    access_type: "offline",
                    response_type: "code",
                },
            },
        }),
    ],
    callbacks: {
        async signIn({ user, account, profile, email, credentials }) {
            /*    console.log("Sign In Callback:", {
                user,
                account,
                profile,
                email,
                credentials,
            }); */
            return true;
        },
        async jwt({ token, account }) {
            /*   console.log("JWT Callback:", { token, account }); */
            if (account) {
                token.accessToken = account.access_token;
                token.idToken = account.id_token;
            }
            return token;
        },
        async session({ session, token }) {
            /*    console.log("Session Callback:", { session, token }); */
            session.accessToken = token.accessToken;
            session.idToken = token.idToken;
            return session;
        },
    },
    debug: true,
};

export default NextAuth(authOptions);
