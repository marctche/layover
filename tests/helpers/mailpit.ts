// Reads sign-in codes out of the local Supabase stack's Mailpit inbox.
//   LAYOVER_TEST_MAILPIT_URL   optional, defaults to http://127.0.0.1:54324

const mailpitUrl = process.env.LAYOVER_TEST_MAILPIT_URL ?? "http://127.0.0.1:54324";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface MailpitSearch {
  messages?: { ID: string }[];
}
interface MailpitMessage {
  Text?: string;
  HTML?: string;
}

/** Waits for the email sent to this address and returns the 6-digit code in it. */
export async function readCode(email: string): Promise<string> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const search = await fetch(`${mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`);
    const found = (await search.json()) as MailpitSearch;
    const id = found.messages?.[0]?.ID;
    if (id) {
      const message = (await (await fetch(`${mailpitUrl}/api/v1/message/${id}`)).json()) as MailpitMessage;
      const code = /<strong>(\d{6})<\/strong>/.exec(message.HTML ?? "")?.[1] ?? /\b(\d{6})\b/.exec(message.Text ?? "")?.[1];
      if (code) return code;
    }
    await sleep(500);
  }
  throw new Error(`No sign-in email arrived for ${email}`);
}
