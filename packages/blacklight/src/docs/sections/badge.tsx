import { Badge } from "@/components/ui/badge";
import { Code, CodeBlock, Paragraph, PreviewBox, SectionDesc, SectionTitle, SubTitle } from "../components/atoms";

export function BadgeSection() {
  return (
    <>
      <SectionTitle>Badge</SectionTitle>
      <SectionDesc>Compact label component for status indicators, severity levels, and metadata tags.</SectionDesc>

      <CodeBlock label="IMPORT">
        <span className="text-status-critical">import</span> {"{ "}
        <span className="text-chart-3">Badge</span>
        {" }"} <span className="text-status-critical">from</span>{" "}
        <span className="text-text-secondary">&quot;@autonoma/blacklight&quot;</span>
        {";"}
      </CodeBlock>

      <SubTitle>Standard Variants</SubTitle>
      <PreviewBox>
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant="default">Default</Badge>
          <Badge variant="secondary">Secondary</Badge>
          <Badge variant="destructive">Destructive</Badge>
          <Badge variant="outline">Outline</Badge>
          <Badge variant="ghost">Ghost</Badge>
        </div>
      </PreviewBox>

      <SubTitle>Severity Variants</SubTitle>
      <Paragraph>
        Use <Code>critical</Code>, <Code>high</Code>, <Code>warn</Code>, <Code>success</Code>, and <Code>neutral</Code>{" "}
        for severity indicators. These use mono font with uppercase tracking; <Code>neutral</Code> is the non-semantic
        tone for informational tags.
      </Paragraph>
      <PreviewBox>
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant="critical">Critical</Badge>
          <Badge variant="high">High</Badge>
          <Badge variant="warn">Warning</Badge>
          <Badge variant="success">Success</Badge>
          <Badge variant="neutral">Neutral</Badge>
        </div>
      </PreviewBox>

      <SubTitle>Status Pill Variants</SubTitle>
      <Paragraph>
        Use <Code>status-passed</Code>, <Code>status-failed</Code>, <Code>status-running</Code>, and{" "}
        <Code>status-pending</Code> for test/job status displays.
      </Paragraph>
      <PreviewBox>
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant="status-passed">Passed</Badge>
          <Badge variant="status-failed">Failed</Badge>
          <Badge variant="status-running">Running</Badge>
          <Badge variant="status-pending">Pending</Badge>
        </div>
      </PreviewBox>
    </>
  );
}

export default BadgeSection;
