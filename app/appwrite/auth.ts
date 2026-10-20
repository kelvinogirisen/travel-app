import { ID, OAuthProvider, Query } from "appwrite";
import { account, tablesDB, appwriteConfig } from "~/appwrite/client";
import { redirect } from "react-router";

export const getExistingUser = async (id: string) => {
    try {
        const { rows, total } = await tablesDB.listRows({
            databaseId: appwriteConfig.databaseId,
            tableId: appwriteConfig.userTableId,
            queries: [Query.equal("accountId", id)],
        });
        return total > 0 ? rows[0] : null;
    } catch (error) {
        console.error("Error fetching user:", error);
        return null;
    }
};

export const storeUserData = async () => {
    try {
        const user = await account.get();
        if (!user) throw new Error("User not found");

        const { providerAccessToken } = (await account.getSession({ sessionId: "current" })) || {};
        const profilePicture = providerAccessToken
            ? await getGooglePicture(providerAccessToken)
            : null;

        const createdUser = await tablesDB.createRow({
            databaseId: appwriteConfig.databaseId,
            tableId: appwriteConfig.userTableId,
            rowId: ID.unique(),
            data: {
                accountId: user.$id,
                email: user.email,
                name: user.name,
                imageUrl: profilePicture,
                joinedAt: new Date().toISOString(),
            },
        });

        if (!createdUser.$id) throw redirect("/sign-in");
    } catch (error) {
        if (error instanceof Response) throw error; // let the redirect through
        console.error("Error storing user data:", error);
    }
};

const getGooglePicture = async (accessToken: string) => {
    try {
        const response = await fetch(
            "https://people.googleapis.com/v1/people/me?personFields=photos",
            { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (!response.ok) throw new Error("Failed to fetch Google profile picture");

        const { photos } = await response.json();
        return photos?.[0]?.url || null;
    } catch (error) {
        console.error("Error fetching Google picture:", error);
        return null;
    }
};

export const loginWithGoogle = async () => {
    try {
        account.createOAuth2Session({
            provider: OAuthProvider.Google,
            success: `${window.location.origin}/`,
            failure: `${window.location.origin}/404`,
        });
    } catch (error) {
        console.error("Error during OAuth2 session creation:", error);
    }
};

export const logoutUser = async () => {
    try {
        await account.deleteSession({ sessionId: "current" });
    } catch (error) {
        console.error("Error during logout:", error);
    }
};

export const getUser = async () => {
    try {
        const user = await account.get();
        if (!user) return redirect("/sign-in");

        const { rows } = await tablesDB.listRows({
            databaseId: appwriteConfig.databaseId,
            tableId: appwriteConfig.userTableId,
            queries: [
                Query.equal("accountId", user.$id),
                Query.select(["name", "email", "imageUrl", "joinedAt", "accountId"]),
            ],
        });

        return rows.length > 0 ? rows[0] : redirect("/sign-in");
    } catch (error) {
        console.error("Error fetching user:", error);
        return null;
    }
};

export const getAllUsers = async (limit: number, offset: number) => {
    try {
        const { rows: users, total } = await tablesDB.listRows({
            databaseId: appwriteConfig.databaseId,
            tableId: appwriteConfig.userTableId,
            queries: [Query.limit(limit), Query.offset(offset)],
        });

        return { users, total };
    } catch (error) {
        console.error("Error fetching users:", error);
        return { users: [], total: 0 };
    }
};