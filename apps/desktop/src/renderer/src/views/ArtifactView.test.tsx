// @vitest-environment jsdom

import type { ArtifactDetail } from '@betterwork/agent-protocol';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ArtifactPage } from './ArtifactView';

const selectedArtifact: ArtifactDetail = {
  id: 'artifact-1',
  workspaceId: 'workspace-1',
  taskId: 'task-1',
  type: 'markdown',
  title: '季度复盘',
  currentVersionId: 'version-1',
  versionNumber: 1,
  origin: 'assistant-run',
  sourceRunId: 'run-1',
  createdAt: 1,
  updatedAt: 1,
  content: '# 当前版本',
  contentHash: 'hash-1',
  evidence: [],
};

afterEach(() => {
  Reflect.deleteProperty(window, 'betterwork');
});

describe('ArtifactPage', () => {
  it('shows MCP evidence as a read-only source without an original-file action', async () => {
    const mcpArtifact: ArtifactDetail = {
      ...selectedArtifact,
      evidence: [
        {
          id: 'evidence-mcp',
          taskId: selectedArtifact.taskId,
          runId: selectedArtifact.sourceRunId ?? 'run-1',
          sourceType: 'mcp-tool',
          sourceUri: 'mcp:finance_monthly_summary',
          title: 'mcp_finance_monthly_summary',
          locator: 'MCP 工具结果',
          excerpt: '{"month":"2026-08","revenue":120}',
          contentHash: 'hash-mcp',
          capturedAt: 1,
        },
      ],
    };
    const onOpenSource = vi.fn(async () => undefined);
    Object.defineProperty(window, 'betterwork', {
      configurable: true,
      value: {
        artifacts: {
          listVersions: vi.fn(async () => []),
          getVersion: vi.fn(async () => null),
        },
      },
    });

    render(
      <ArtifactPage
        artifacts={[mcpArtifact]}
        selected={mcpArtifact}
        onSelect={vi.fn()}
        onSave={vi.fn(async () => undefined)}
        onExport={vi.fn(async () => ({ cancelled: true }))}
        onOpenSource={onOpenSource}
        onOpenFile={vi.fn(async () => ({ opened: true }))}
        onStartFromVersion={vi.fn(async () => undefined)}
        onBack={vi.fn()}
      />,
    );

    expect(screen.getByText((content) => content.includes('MCP 工具'))).toBeTruthy();
    expect(screen.queryByRole('button', { name: '原文' })).toBeNull();
    expect(onOpenSource).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('shows a version-list loading failure while previewing the Artifact', async () => {
    Object.defineProperty(window, 'betterwork', {
      configurable: true,
      value: {
        artifacts: {
          listVersions: vi.fn(async () => {
            throw new Error('版本历史暂不可用');
          }),
          getVersion: vi.fn(async () => null),
        },
      },
    });

    render(
      <ArtifactPage
        artifacts={[selectedArtifact]}
        selected={selectedArtifact}
        onSelect={vi.fn()}
        onSave={vi.fn(async () => undefined)}
        onExport={vi.fn(async () => ({ cancelled: true }))}
        onOpenSource={vi.fn(async () => undefined)}
        onOpenFile={vi.fn(async () => ({ opened: true }))}
        onStartFromVersion={vi.fn(async () => undefined)}
        onBack={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('版本历史暂不可用'),
    );
  });
});
