interface Props {
  onClose: () => void;
}

/**
 * Shown once, before the first dungeon.
 *
 * The premise is a reversal, and a player dropped onto a grid of rock has no
 * way to guess it. Three lines is enough to make the first ten minutes make
 * sense; the step hints handle the rest.
 */
export function IntroDialog({ onClose }: Props) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal narrow" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>당신은 던전의 관리자입니다</h2>
        </header>

        <ol className="intro-list">
          <li>
            <b>모험가가 쳐들어옵니다.</b> 입구에서 코어까지 최단 경로로 걸어옵니다.
            코어에 닿으면 금고를 털립니다.
          </li>
          <li>
            <b>길은 당신이 팝니다.</b> 통로를 길게 돌리면 함정과 부하가 붙을
            시간이 늘어납니다. 대신 굴착 비용이 듭니다.
          </li>
          <li>
            <b>쓰러뜨린 자는 돌아옵니다.</b> 레벨을 올려서. 죽이면 장비를 남기고,
            감옥에 가두면 시간이 지나 당신의 부하가 됩니다.
          </li>
        </ol>

        <p className="modal-note">
          게임 오버는 없습니다. 돌파당해도 잃는 것은 골드와 시간뿐이고,
          던전과 부하는 그대로 남습니다.
        </p>

        <div className="actions">
          <button className="primary" onClick={onClose}>던전을 파러 갑니다</button>
        </div>
      </div>
    </div>
  );
}
