import { appwriteConfig, tablesDB } from "~/appwrite/client";
import { Query } from "appwrite";

export const getAllTrips = async (limit: number, offset: number) => {
    const { rows, total } = await tablesDB.listRows({
        databaseId: appwriteConfig.databaseId,
        tableId: appwriteConfig.tripTableId,
        queries: [Query.limit(limit), Query.offset(offset), Query.orderDesc("createdAt")],
    });

    if (total === 0) {
        console.error("No trips found");
        return { allTrips: [], total: 0 };
    }

    return {
        allTrips: rows,
        total,
    };
};

export const getTripById = async (tripId: string) => {
    try {
        const trip = await tablesDB.getRow({
            databaseId: appwriteConfig.databaseId,
            tableId: appwriteConfig.tripTableId,
            rowId: tripId,
        });

        return trip;
    } catch (error) {
        console.error("Trip not found:", error);
        return null;
    }
};