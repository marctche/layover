import Link from "next/link";
import { Suspense } from "react";
import { requireReadyUser } from "@/app/_lib/request";
import { NewTripForm } from "./new-trip-form";

export const metadata = { title: "New trip | Layover" };

export default function NewTripPage() {
  return (
    <main className="mx-auto w-full max-w-md px-4 py-10">
      <Link href="/trips" className="text-sm text-zinc-600 underline dark:text-zinc-400">
        All trips
      </Link>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">New trip</h1>
      <Suspense fallback={<p className="mt-6 text-sm text-zinc-500">Loading...</p>}>
        <Form />
      </Suspense>
    </main>
  );
}

async function Form() {
  await requireReadyUser("/trips/new");
  return <NewTripForm />;
}
