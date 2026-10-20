// app/lib/paystack.ts  (replaces app/lib/stripe.ts)
// Server-only: uses PAYSTACK_SECRET_KEY, so only import this from route actions/loaders.

const PAYSTACK_BASE = "https://api.paystack.co";

const headers = () => {
    const secret = process.env.PAYSTACK_SECRET_KEY;
    if (!secret) throw new Error("Missing PAYSTACK_SECRET_KEY");
    return {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
    };
};

interface CreatePaymentLinkArgs {
    name: string;
    description: string;
    price: number; // whole units, e.g. 1500 means $1,500
    tripId: string;
    customerEmail: string; // Paystack requires the customer's email when initialising a payment
}

export const createPaymentLink = async ({
    name,
    description,
    price,
    tripId,
    customerEmail,
}: CreatePaymentLinkArgs) => {
    // Unique per attempt, and traceable back to the trip
    const reference = `trip_${tripId}_${Date.now()}`;

    const response = await fetch(`${PAYSTACK_BASE}/transaction/initialize`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
            email: customerEmail,
            amount: price * 100, // subunit: cents for USD, kobo for NGN
            currency: "NGN", // USD must be enabled on your Paystack account; otherwise use "NGN"
            reference,
            callback_url: `${process.env.VITE_BASE_URL}/travel/${tripId}/success`,
            metadata: { tripId, tripName: name, description },
        }),
    });

    const json = await response.json();

    if (!response.ok || !json.status) {
        throw new Error(`Paystack initialize failed: ${json.message ?? response.status}`);
    }

    // Same shape the route already uses (`paymentLink.url`)
    return {
        url: json.data.authorization_url as string,
        reference: json.data.reference as string,
    };
};

// Call this from the success route. Never trust the redirect alone: anyone can open the success URL.
// Paystack appends ?reference=...&trxref=... to your callback_url.
export const verifyPayment = async (reference: string) => {
    const response = await fetch(
        `${PAYSTACK_BASE}/transaction/verify/${encodeURIComponent(reference)}`,
        { headers: headers() }
    );

    const json = await response.json();

    if (!response.ok || !json.status) {
        throw new Error(`Paystack verify failed: ${json.message ?? response.status}`);
    }

    return {
        paid: json.data.status === "success",
        amount: json.data.amount as number, // subunit
        currency: json.data.currency as string,
        tripId: json.data.metadata?.tripId as string | undefined,
    };
};