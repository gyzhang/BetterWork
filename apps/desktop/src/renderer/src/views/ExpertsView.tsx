import type { ExpertSummary } from '@betterwork/agent-protocol';

import { EmptyPage, LoadingPage } from '../components/EmptyState';
import { PageHeader } from '../components/layout/PageHeader';
import type { ExpertsState } from '../hooks/use-experts';
import { ExpertIcon } from '../icons';
import { reportAction } from '../lib/async-action';

const lifecycleName = {
  active: '可召唤',
  disabled: '已停用',
  archived: '已归档',
} as const;

function ExpertCard({
  expert,
  onSummon,
  onError,
}: {
  expert: ExpertSummary;
  onSummon: (expert: ExpertSummary) => Promise<void>;
  onError: (message: string) => void;
}): React.JSX.Element {
  const blocked = expert.blockedReasons.length > 0;
  const unavailable = expert.lifecycle !== 'active';
  return (
    <article className="expert-card">
      <div className="expert-card-head">
        <span className="expert-card-mark" aria-hidden="true">
          <ExpertIcon size={18} />
        </span>
        <div>
          <strong>{expert.name}</strong>
          <small>{lifecycleName[expert.lifecycle]}</small>
        </div>
      </div>
      <p className="expert-card-desc">{expert.summary || '暂无说明'}</p>
      {blocked && (
        <p className="expert-card-status">配置待补全：{expert.blockedReasons.join('、')}</p>
      )}
      <button
        className="primary-button expert-summon-button"
        type="button"
        disabled={unavailable}
        onClick={() => reportAction(onSummon(expert), onError, '无法召唤该专家。')}
      >
        召唤
      </button>
    </article>
  );
}

export function ExpertsPage({
  state,
  onSummon,
  onError,
}: {
  state: ExpertsState;
  onSummon: (expert: ExpertSummary) => Promise<void>;
  onError: (message: string) => void;
}): React.JSX.Element {
  return (
    <section className="experts-page">
      <PageHeader eyebrow="专家" title="召唤固定的工作方式" />
      {state.error && (
        <p className="inline-message error" role="alert">
          {state.error}
        </p>
      )}
      <div className="page-scroll skills-scroll">
        <section className="page-body skills-body">
          {state.loading ? (
            <LoadingPage label="正在加载专家…" />
          ) : state.experts.length === 0 ? (
            <EmptyPage
              eyebrow="专家"
              title="还没有可召唤的专家"
              detail="在专家配置中创建一个固定的工作方式。"
            />
          ) : (
            <div className="expert-cards">
              {state.experts.map((expert) => (
                <ExpertCard key={expert.id} expert={expert} onSummon={onSummon} onError={onError} />
              ))}
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
