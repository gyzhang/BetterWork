interface WelcomeProps {
  userName?: string | undefined;
}

export function Welcome({ userName = '' }: WelcomeProps): React.JSX.Element {
  return (
    <div className="welcome">
      <h2>{userName ? `${userName}，今天要处理什么工作？` : '今天要处理什么工作？'}</h2>
      <p>输入这次任务的具体要求，点击「开始工作」后执行。</p>
    </div>
  );
}
