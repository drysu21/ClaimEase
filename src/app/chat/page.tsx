import type { Metadata } from 'next';
import { currentEmployee } from '@/lib/auth';
import { getDb } from '@/lib/store';
import { getAllRulesForGrade } from '@/lib/claims';
import { agentInfo } from '@/lib/agent';
import { Chat } from '@/components/Chat';
import { LimitsPanel } from '@/components/LimitsPanel';

export const metadata: Metadata = { title: 'New claim' };

const EXAMPLES = [
  'I spent 2,400 rupees on a client dinner yesterday, submit it.',
  'How much can I claim for a hotel in Mumbai?',
  'Show my pending claims.',
];

export default async function ChatPage() {
  const me = await currentEmployee();
  const rules = await getAllRulesForGrade(getDb(), me.grade);
  return (
    <div className="page chat-page">
      <Chat employee={{ id: me.id, name: me.name, grade: me.grade }} agent={agentInfo()} examples={EXAMPLES} />
      <LimitsPanel grade={me.grade} rules={rules} />
    </div>
  );
}
