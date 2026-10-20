import { Header } from "../../../components";
import { ComboBoxComponent } from "@syncfusion/ej2-react-dropdowns";
import type { Route } from "./+types/create-trip";
import { comboBoxItems, selectItems } from "~/constants";
import { cn, formatKey } from "~/lib/utils";
import { LayerDirective, LayersDirective, MapsComponent } from "@syncfusion/ej2-react-maps";
import React, { useState } from "react";
import { world_map } from "~/constants/world_map";
import { ButtonComponent } from "@syncfusion/ej2-react-buttons";
import { account } from "~/appwrite/client";
import { useNavigate } from "react-router";

const PAGE_SIZE = 100; // REST Countries v5 allows 1–100 per page (default 25)

const FIELDS = [
    "names.common",
    "coordinates.lat",
    "coordinates.lng",
    "links.open_street_maps",
    "flag.emoji",
].join(",");

// Module-level cache: the country list rarely changes, so fetch it once per server process
// instead of burning API quota on every page visit.
let cachedCountries: Country[] | null = null;

export const loader = async (): Promise<Country[]> => {
    if (cachedCountries) return cachedCountries;

    // Server-only env var (no VITE_ prefix) so the key never reaches the browser bundle
    const apiKey = process.env.RESTCOUNTRIES_API_KEY;
    if (!apiKey) throw new Error("Missing RESTCOUNTRIES_API_KEY");

    const all: any[] = [];
    let offset = 0;

    // 250+ countries means several pages of 100
    while (true) {
        const response = await fetch(
            `https://api.restcountries.com/countries/v5?response_fields=${FIELDS}&limit=${PAGE_SIZE}&offset=${offset}`,
            { headers: { Authorization: `Bearer ${apiKey}` } }
        );

        if (!response.ok) {
            throw new Error(`Failed to fetch countries: ${response.status}`);
        }

        const json = await response.json();
        // v5 nests the country list under `data.objects`
        const page = json.data?.objects;

        if (!Array.isArray(page)) {
            throw new Error(`Unexpected response: ${JSON.stringify(json).slice(0, 300)}`);
        }

        all.push(...page);
        // Stop on the last page (or after 1,000 records, as a guard against an endless loop)
        if (page.length < PAGE_SIZE || offset >= 1000) break;
        offset += PAGE_SIZE;
    }

    cachedCountries = all
        .map((country: any) => ({
            name: `${country.flag?.emoji ?? ""} ${country.names?.common ?? ""}`.trim(),
            coordinates: [country.coordinates?.lat, country.coordinates?.lng] as [number, number],
            value: country.names?.common as string,
            openStreetMap: country.links?.open_street_maps as string | undefined,
        }))
        .filter((c) => c.value)
        .sort((a, b) => a.value.localeCompare(b.value));

    return cachedCountries;
};

const CreateTrip = ({ loaderData }: Route.ComponentProps) => {
    const countries = loaderData as Country[];
    const navigate = useNavigate();

    const [formData, setFormData] = useState<TripFormData>({
        // `value` (plain country name) is what the dropdown stores, so initialise with it too
        country: countries[0]?.value || "",
        travelStyle: "",
        interest: "",
        budget: "",
        duration: 0,
        groupType: "",
    });
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        if (
            !formData.country ||
            !formData.travelStyle ||
            !formData.interest ||
            !formData.budget ||
            !formData.groupType
        ) {
            setError("Please provide values for all fields");
            setLoading(false);
            return;
        }

        if (formData.duration < 1 || formData.duration > 10) {
            setError("Duration must be between 1 and 10 days");
            setLoading(false);
            return;
        }

        try {
            // Inside the try block so a failed session lookup can't leave the button stuck on "Generating..."
            const user = await account.get();
            if (!user.$id) {
                console.error("User not authenticated");
                return;
            }

            const response = await fetch("/api/create-trip", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    country: formData.country,
                    numberOfDays: formData.duration,
                    travelStyle: formData.travelStyle,
                    interests: formData.interest,
                    budget: formData.budget,
                    groupType: formData.groupType,
                    userId: user.$id,
                    email:user.email,
                }),
            });

            const result: CreateTripResponse = await response.json();

            if (result?.id) navigate(`/trips/${result.id}`);
            else console.error("Failed to generate a trip");
        } catch (e) {
            console.error("Error generating trip", e);
        } finally {
            setLoading(false);
        }
    };

    const handleChange = (key: keyof TripFormData, value: string | number) => {
        setFormData({ ...formData, [key]: value });
    };

    const countryData = countries.map((country) => ({
        text: country.name,
        value: country.value,
    }));

    const mapData = [
        {
            country: formData.country,
            color: "#EA382E",
            // Compare against `value` (plain name), not `name` (which includes the flag emoji)
            coordinates:
                countries.find((c: Country) => c.value === formData.country)?.coordinates || [],
        },
    ];

    return (
        <main className="flex flex-col gap-10 pb-20 wrapper">
            <Header title="Add a New Trip" description="View and edit AI Generated travel plans" />

            <section className="mt-2.5 wrapper-md">
                <form className="trip-form" onSubmit={handleSubmit}>
                    <div>
                        <label htmlFor="country">Country</label>
                        <ComboBoxComponent
                            id="country"
                            dataSource={countryData}
                            fields={{ text: "text", value: "value" }}
                            placeholder="Select a Country"
                            className="combo-box"
                            change={(e: { value: string | undefined }) => {
                                if (e.value) {
                                    handleChange("country", e.value);
                                }
                            }}
                            allowFiltering
                            filtering={(e) => {
                                const query = e.text.toLowerCase();

                                e.updateData(
                                    countries
                                        .filter((country) => country.name.toLowerCase().includes(query))
                                        .map((country) => ({
                                            text: country.name,
                                            value: country.value,
                                        }))
                                );
                            }}
                        />
                    </div>

                    <div>
                        <label htmlFor="duration">Duration</label>
                        <input
                            id="duration"
                            name="duration"
                            type="number"
                            placeholder="Enter a number of days"
                            className="form-input placeholder:text-gray-100"
                            onChange={(e) => handleChange("duration", Number(e.target.value))}
                        />
                    </div>

                    {selectItems.map((key) => (
                        <div key={key}>
                            <label htmlFor={key}>{formatKey(key)}</label>

                            <ComboBoxComponent
                                id={key}
                                dataSource={comboBoxItems[key].map((item) => ({
                                    text: item,
                                    value: item,
                                }))}
                                fields={{ text: "text", value: "value" }}
                                placeholder={`Select ${formatKey(key)}`}
                                change={(e: { value: string | undefined }) => {
                                    if (e.value) {
                                        handleChange(key, e.value);
                                    }
                                }}
                                allowFiltering
                                filtering={(e) => {
                                    const query = e.text.toLowerCase();

                                    e.updateData(
                                        comboBoxItems[key]
                                            .filter((item) => item.toLowerCase().includes(query))
                                            .map((item) => ({
                                                text: item,
                                                value: item,
                                            }))
                                    );
                                }}
                                className="combo-box"
                            />
                        </div>
                    ))}

                    <div>
                        <label htmlFor="location">Location on the world map</label>
                        <MapsComponent>
                            <LayersDirective>
                                <LayerDirective
                                    shapeData={world_map}
                                    dataSource={mapData}
                                    shapePropertyPath="name"
                                    shapeDataPath="country"
                                    shapeSettings={{ colorValuePath: "color", fill: "#E5E5E5" }}
                                />
                            </LayersDirective>
                        </MapsComponent>
                    </div>

                    <div className="bg-gray-200 h-px w-full" />

                    {error && (
                        <div className="error">
                            <p>{error}</p>
                        </div>
                    )}

                    <footer className="px-6 w-full">
                        <ButtonComponent
                            type="submit"
                            className="button-class !h-12 !w-full"
                            disabled={loading}
                        >
                            <img
                                src={`/assets/icons/${loading ? "loader.svg" : "magic-star.svg"}`}
                                className={cn("size-5", { "animate-spin": loading })}
                            />
                            <span className="p-16-semibold text-white">
                                {loading ? "Generating..." : "Generate Trip"}
                            </span>
                        </ButtonComponent>
                    </footer>
                </form>
            </section>
        </main>
    );
};

export default CreateTrip;
