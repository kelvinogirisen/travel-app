import { type ActionFunctionArgs, data } from "react-router";
import { GoogleGenAI } from "@google/genai";
import { ID } from "appwrite";
import { appwriteConfig, tablesDB } from "~/appwrite/client";
import { createPaymentLink } from "~/lib/paystack";

// Gemini may return plain JSON or JSON wrapped in ```json fences, depending on model and prompt.
// This handles both by stripping any fences and parsing from the first "{" to the last "}".
const parseModelJson = <T>(text: string): T | null => {
    const cleaned = text.replace(/```(?:json)?/gi, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end <= start) return null;

    try {
        return JSON.parse(cleaned.slice(start, end + 1)) as T;
    } catch (e) {
        console.error("Failed to parse Gemini JSON:", e);
        return null;
    }
};

export const action = async ({ request }: ActionFunctionArgs) => {
    const {
        country,
        numberOfDays,
        travelStyle,
        interests,
        budget,
        groupType,
        userId,
        email, // Paystack requires the customer's email to create a payment
    } = await request.json();

    if (!email) {
        return data({ error: "Customer email is required" }, { status: 400 });
    }

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const unsplashApiKey = process.env.UNSPLASH_ACCESS_KEY;

    try {
        const prompt = `Generate a ${numberOfDays}-day travel itinerary for ${country} based on the following user information:
        Budget: '${budget}'
        Interests: '${interests}'
        TravelStyle: '${travelStyle}'
        GroupType: '${groupType}'
        Return the itinerary and lowest estimated price in a clean, non-markdown JSON format with the following structure.
        Use double quotes for every string so the output is valid JSON:
        {
        "name": "A descriptive title for the trip",
        "description": "A brief description of the trip and its highlights not exceeding 100 words",
        "estimatedPrice": "Lowest average price for the trip in USD as a single number, e.g. $1500",
        "duration": ${numberOfDays},
        "budget": "${budget}",
        "travelStyle": "${travelStyle}",
        "country": "${country}",
        "interests": "${interests}",
        "groupType": "${groupType}",
        "bestTimeToVisit": [
          "🌸 Season (from month to month): reason to visit",
          "☀️ Season (from month to month): reason to visit",
          "🍁 Season (from month to month): reason to visit",
          "❄️ Season (from month to month): reason to visit"
        ],
        "weatherInfo": [
          "☀️ Season: temperature range in Celsius (temperature range in Fahrenheit)",
          "🌦️ Season: temperature range in Celsius (temperature range in Fahrenheit)",
          "🌧️ Season: temperature range in Celsius (temperature range in Fahrenheit)",
          "❄️ Season: temperature range in Celsius (temperature range in Fahrenheit)"
        ],
        "location": {
          "city": "name of the city or region",
          "coordinates": [latitude, longitude],
          "openStreetMap": "link to open street map"
        },
        "itinerary": [
        {
          "day": 1,
          "location": "City/Region Name",
          "activities": [
            {"time": "Morning", "description": "🏰 Visit the local historic castle and enjoy a scenic walk"},
            {"time": "Afternoon", "description": "🖼️ Explore a famous art museum with a guided tour"},
            {"time": "Evening", "description": "🍷 Dine at a rooftop restaurant with local wine"}
          ]
        }
        ]
    }
    Include one itinerary object for each of the ${numberOfDays} days. Return only the JSON object.`;

        const textResult = await ai.models.generateContent({
            // Set GEMINI_MODEL in .env to a current Flash model from Google's models page
            model: process.env.GEMINI_MODEL ?? "gemini-3.8-flash",
            contents: [prompt],
            config: { responseMimeType: "application/json" }, // ask Gemini for raw JSON output
        });

        // In @google/genai, `text` is a property, not a method
        const rawText = textResult.text ?? "";
        const trip = parseModelJson<Trip>(rawText);
        if (!trip) {
            console.error("Raw Gemini output:", rawText.slice(0, 1000));
            throw new Error("Gemini returned no parseable JSON");
        }

        // Images are a nice-to-have: if Unsplash fails, still create the trip
        let imageUrls: string[] = [];
        try {
            const query = encodeURIComponent(`${country} ${interests} ${travelStyle}`);
            const imageResponse = await fetch(
                `https://api.unsplash.com/search/photos?query=${query}&client_id=${unsplashApiKey}`
            );

            if (imageResponse.ok) {
                const imageJson = await imageResponse.json();
                imageUrls = (imageJson.results ?? [])
                    .slice(0, 3)
                    .map((result: any) => result.urls?.regular)
                    .filter(Boolean);
            } else {
                console.error("Unsplash request failed:", imageResponse.status);
            }
        } catch (imageError) {
            console.error("Error fetching images:", imageError);
        }

        // Take the first number in the price string; handles "$1,500" and ranges like "$1,200 - $1,500"
        const priceMatch = trip.estimatedPrice.replace(/,/g, "").match(/\d+(\.\d+)?/);
        const tripPrice = priceMatch ? Math.round(parseFloat(priceMatch[0])) : NaN;
        if (!Number.isFinite(tripPrice)) {
            throw new Error(`Could not parse price: ${trip.estimatedPrice}`);
        }

        // Generate the row ID up front so the Paystack link can be created BEFORE the row exists.
        // That lets us write the row once, with payment_link included, so the table only needs
        // Create permission for the Any role (no Update permission).
        const tripId = ID.unique();

        const paymentLink = await createPaymentLink({
            name: trip.name,
            description: trip.description,
            price: tripPrice,
            tripId,
            customerEmail: email,
        });

        const result = await tablesDB.createRow({
            databaseId: appwriteConfig.databaseId,
            tableId: appwriteConfig.tripTableId,
            rowId: tripId,
            data: {
                tripDetail: JSON.stringify(trip),
                createdAt: new Date().toISOString(),
                imageUrls,
                userId,
                payment_link: paymentLink.url,
            },
        });

        return data({ id: result.$id });
    } catch (e) {
        console.error("Error generating travel plan: ", e);
        // Always return a response: the client calls response.json(), which fails on an empty reply
        return data({ error: "Failed to generate travel plan" }, { status: 500 });
    }
};