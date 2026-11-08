import { DemoCallWidget } from "./demo-call-widget";
import { LiveCallDemo } from "./live-call-demo";

/**
 * The hero demo. When a public demo agent is configured the visitor gets a
 * real call they can interrupt; otherwise they get the scripted walkthrough,
 * so the page is never broken by a missing deployment.
 */
export function CallDemo() {
  const agentId = process.env.NEXT_PUBLIC_DEMO_AGENT_ID;
  if (!agentId) return <LiveCallDemo />;
  return <DemoCallWidget agentId={agentId} sessionPath="/api/voice/demo-session" />;
}
