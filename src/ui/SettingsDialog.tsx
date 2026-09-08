import type { Quality, Settings } from "../game/settings";

interface Props {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  onReplayTutorial: () => void;
  onResetDungeon: () => void;
  resetDisabled: boolean;
  onClose: () => void;
}

const QUALITY_LABEL: Record<Quality, string> = {
  high: "높음",
  low: "낮음 (성능 우선)",
};

export function SettingsDialog({
  settings,
  onChange,
  onReplayTutorial,
  onResetDungeon,
  resetDisabled,
  onClose,
}: Props) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal narrow" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>설정</h2>
          <button className="icon-btn" onClick={onClose} aria-label="닫기">×</button>
        </header>

        <div className="setting-row">
          <span>소리</span>
          <button onClick={() => onChange({ muted: !settings.muted })}>
            {settings.muted ? "꺼짐" : "켜짐"}
          </button>
        </div>

        <div className="setting-row">
          <span>그래픽 품질</span>
          <button
            onClick={() => onChange({ quality: settings.quality === "high" ? "low" : "high" })}
          >
            {QUALITY_LABEL[settings.quality]}
          </button>
        </div>
        <p className="hint small">
          낮음은 렌더 해상도를 1배로 고정합니다. 모바일에서 프레임이 떨어질 때 쓰세요.
        </p>

        <div className="setting-row">
          <span>튜토리얼</span>
          <button onClick={onReplayTutorial}>다시 보기</button>
        </div>

        <div className="setting-row danger-row">
          <span>던전 초기화</span>
          <button className="danger" disabled={resetDisabled} onClick={onResetDungeon}>
            초기화
          </button>
        </div>
        <p className="hint small warn">
          던전 구조·부하·연구가 모두 사라집니다. 되돌릴 수 없습니다.
        </p>
      </div>
    </div>
  );
}
