import { MessageSquareText } from "lucide-react";
import { useLineOfBusiness } from "../LineOfBusinessContext";
import { AskAIExperience } from "./AskAIExperience";

export function AskAIPage() {
  const { lineOfBusiness } = useLineOfBusiness();
  return (
    <div className="page-stack ask-ai-page">
      <div className="page-intro">
        <div>
          <p className="eyebrow">EVIDENCE-FIRST PLATFORM INVESTIGATION</p>
          <h1>Ask Your Data Platform AI</h1>
          <p className="intro-copy">Investigate {formatLabel(lineOfBusiness)} Insurance data health with answers grounded in current incidents, lineage, dataset freshness, and saved findings.</p>
        </div>
      </div>
      <div className="ask-ai-page-layout">
        <AskAIExperience />
        <aside className="panel ask-ai-guide">
          <span className="ask-ai-guide-icon"><MessageSquareText size={17} /></span>
          <p className="eyebrow">HOW ANSWERS WORK</p>
          <h2>Grounded, concise, linked</h2>
          <p>Each answer uses existing FastAPI records. It distinguishes observed evidence from persisted RCA, points out missing records, and links to the relevant product, dataset, incident, lineage, evidence, or remediation view.</p>
          <div className="ask-ai-guide-list">
            <span>1 <strong>Ask a focused question</strong></span>
            <span>2 <strong>Review the source-backed answer</strong></span>
            <span>3 <strong>Open a linked record to investigate</strong></span>
          </div>
          <p className="ask-ai-guide-note">No hidden chain-of-thought is shown. This API version does not expose a conversational LLM endpoint, so Gemini is not called and cannot be reported as having answered.</p>
        </aside>
      </div>
    </div>
  );
}

function formatLabel(value: string): string {
  return value.split(/[_\s-]+/).filter(Boolean).map((part) =>
    part.charAt(0).toUpperCase() + part.slice(1),
  ).join(" ");
}
