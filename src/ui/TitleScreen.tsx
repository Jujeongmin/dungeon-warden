interface Props {
  /** True when the dungeon has already been played. */
  hasProgress: boolean;
  /** Dungeon summary shown on the continue card. */
  summary: { threat: number; wavesRepelled: number; coreBreaches: number } | null;
  loading: boolean;
  offline: boolean;
  onStart: () => void;
  onSettings: () => void;
  onLeaderboard: () => void;
  onShop: () => void;
}

/**
 * The front door.
 *
 * The game used to drop the player straight onto a grid of rock with no idea
 * what they were looking at. This says what the game is in one line before
 * anything else happens, and gives returning players their dungeon's standing
 * before they commit to a session.
 */
export function TitleScreen({
  hasProgress,
  summary,
  loading,
  offline,
  onStart,
  onSettings,
  onLeaderboard,
  onShop,
}: Props) {
  return (
    <div className="title">
      <div className="title-inner">
        <p className="title-kicker">모험가가 아니라, 던전이 되어라</p>
        <h1 className="title-name">DUNGEON WARDEN</h1>
        <p className="title-line">
          방을 파고 함정을 놓고 부하를 세워, 몇 번이고 다시 찾아오는 모험가를 막아내세요.
          쓰러뜨린 자는 장비를 남기고, 사로잡은 자는 당신의 편이 됩니다.
        </p>

        {hasProgress && summary && (
          <div className="title-save">
            <span>위협도 {summary.threat}</span>
            <span>격퇴 {summary.wavesRepelled}</span>
            <span>돌파 {summary.coreBreaches}</span>
          </div>
        )}

        <button className="title-start" onClick={onStart} disabled={loading}>
          {loading ? "던전을 불러오는 중…" : hasProgress ? "이어하기" : "던전 파기 시작"}
        </button>

        <div className="title-menu">
          <button onClick={onSettings}>설정</button>
          <button onClick={onLeaderboard}>순위표</button>
          <button onClick={onShop}>상점</button>
        </div>

        {offline && (
          <p className="title-note">
            로컬 전용 모드입니다. 진행이 저장되지 않습니다.
          </p>
        )}
      </div>
    </div>
  );
}
