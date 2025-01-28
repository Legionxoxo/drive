export const authConfig = {
    baseUrl: "https://login.myairvault.com/api/v1",
    loginUrl: "https://login.myairvault.com",
    clientId: process.env.NEXT_PUBLIC_AV_CLIENT_ID || "",
    clientSecret: process.env.AV_CLIENT_SECRET || "",
};
