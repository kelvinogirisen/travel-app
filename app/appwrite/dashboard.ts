import { Query } from "appwrite";
import { parseTripData } from "~/lib/utils";
import { tablesDB, appwriteConfig } from "./client";

// Renamed from `Document` so it no longer shadows the global DOM `Document` type
interface Row {
    [key: string]: any;
}

type FilterByDate = (
    items: Row[],
    key: string,
    start: Date,
    end?: Date
) => number;

// listRows returns only 25 rows by default, which would make every stat below wrong
// once a table grows past that. This helper pages through the whole table.
const listAllRows = async (tableId: string): Promise<Row[]> => {
    const all: Row[] = [];
    let cursor: string | undefined;

    while (true) {
        const { rows } = await tablesDB.listRows({
            databaseId: appwriteConfig.databaseId,
            tableId,
            queries: [
                Query.limit(100),
                ...(cursor ? [Query.cursorAfter(cursor)] : []),
            ],
        });

        all.push(...rows);
        if (rows.length < 100) break;
        cursor = rows[rows.length - 1].$id;
    }

    return all;
};

const filterByDate: FilterByDate = (items, key, start, end) =>
    items.filter((item) => {
        const time = new Date(item[key]).getTime();
        return time >= start.getTime() && (!end || time <= end.getTime());
    }).length;

export const getUsersAndTripsStats = async (): Promise<DashboardStats> => {
    const d = new Date();
    const startCurrent = new Date(d.getFullYear(), d.getMonth(), 1);
    const startPrev = new Date(d.getFullYear(), d.getMonth() - 1, 1);
    // End of the last day of the previous month (the original stopped at midnight)
    const endPrev = new Date(d.getFullYear(), d.getMonth(), 0, 23, 59, 59, 999);

    const [users, trips] = await Promise.all([
        listAllRows(appwriteConfig.userTableId),
        listAllRows(appwriteConfig.tripTableId),
    ]);

    const regularUsers = users.filter((u) => u.status === "user");

    return {
        totalUsers: users.length,
        usersJoined: {
            currentMonth: filterByDate(users, "joinedAt", startCurrent),
            lastMonth: filterByDate(users, "joinedAt", startPrev, endPrev),
        },
        userRole: {
            total: regularUsers.length,
            currentMonth: filterByDate(regularUsers, "joinedAt", startCurrent),
            lastMonth: filterByDate(regularUsers, "joinedAt", startPrev, endPrev),
        },
        totalTrips: trips.length,
        tripsCreated: {
            currentMonth: filterByDate(trips, "createdAt", startCurrent),
            lastMonth: filterByDate(trips, "createdAt", startPrev, endPrev),
        },
    };
};

const countPerDay = (items: Row[], key: string) => {
    const counts = items.reduce((acc: { [key: string]: number }, item) => {
        const day = new Date(item[key]).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
        });
        acc[day] = (acc[day] || 0) + 1;
        return acc;
    }, {});

    return Object.entries(counts).map(([day, count]) => ({
        count: Number(count),
        day,
    }));
};

export const getUserGrowthPerDay = async () => {
    const users = await listAllRows(appwriteConfig.userTableId);
    return countPerDay(users, "joinedAt");
};

export const getTripsCreatedPerDay = async () => {
    const trips = await listAllRows(appwriteConfig.tripTableId);
    return countPerDay(trips, "createdAt");
};

export const getTripsByTravelStyle = async () => {
    const trips = await listAllRows(appwriteConfig.tripTableId);

    const travelStyleCounts = trips.reduce(
        (acc: { [key: string]: number }, trip) => {
            const tripDetail = parseTripData(trip.tripDetails);

            if (tripDetail && tripDetail.travelStyle) {
                const travelStyle = tripDetail.travelStyle;
                acc[travelStyle] = (acc[travelStyle] || 0) + 1;
            }
            return acc;
        },
        {}
    );

    return Object.entries(travelStyleCounts).map(([travelStyle, count]) => ({
        count: Number(count),
        travelStyle,
    }));
};