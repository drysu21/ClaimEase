import { NextResponse } from 'next/server';
import { currentEmployee } from '@/lib/auth';
import { getDb } from '@/lib/store';
import { todayISO } from '@/lib/domain';
import { BusyError, handleChat } from '@/lib/agent';
import { resetSession } from '@/lib/agent/sessions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_MESSAGE_CHARS = 1000;

export async function POST(req: Request) {
  let body: { sessionId?: unknown; message?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Send a JSON body with a "message".' }, { status: 400 });
  }
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!message) return NextResponse.json({ error: 'Type a message first.' }, { status: 400 });
  if (message.length > MAX_MESSAGE_CHARS) {
    return NextResponse.json({ error: `Please keep messages under ${MAX_MESSAGE_CHARS} characters.` }, { status: 400 });
  }

  try {
    const employee = await currentEmployee();
    const result = await handleChat({
      db: getDb(),
      employee,
      sessionId: typeof body.sessionId === 'string' ? body.sessionId : undefined,
      message,
      today: todayISO(),
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof BusyError) return NextResponse.json({ error: err.message }, { status: 409 });
    console.error('[api/chat]', err);
    return NextResponse.json({ error: 'Something went wrong on our side. Please try again.' }, { status: 500 });
  }
}

/** Ends a chat so its server-side memory is freed. */
export async function DELETE(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { sessionId?: unknown };
  const employee = await currentEmployee();
  if (typeof body.sessionId === 'string') resetSession(body.sessionId, employee.id);
  return NextResponse.json({ ok: true });
}
