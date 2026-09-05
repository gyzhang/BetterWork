export function Welcome({ setPrompt }: { setPrompt: (value: string) => void }): React.JSX.Element {
  return (
    <div className="welcome">
      <div className="abacus" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </div>
      <p className="eyebrow">算台 · 知识工作台</p>
      <h2>以我所知，成我所作</h2>
      <p>从一个清楚的问题开始，算台会协助你把过程沉淀为可以继续使用的成果。</p>
      <div className="examples">
        <button onClick={() => setPrompt('计算: (128 + 72) / 4')}>计算一组数据</button>
        <button onClick={() => setPrompt('读取: README.md')}>读取一份资料</button>
      </div>
    </div>
  );
}
