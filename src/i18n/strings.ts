/**
 * UI text.
 *
 * Verse8 is a global platform, so Korean-only would hide the game from most of
 * its audience. Strings live in one file per language rather than scattered in
 * components, so a missing translation is visible as a gap in the table rather
 * than a stray Korean sentence in an English build.
 */

export type Locale = "ko" | "en";

export const LOCALE_LABEL: Record<Locale, string> = {
  ko: "한국어",
  en: "English",
};

const ko = {
  // Shell
  title_kicker: "모험가가 아니라, 던전이 되어라",
  title_line:
    "방을 파고 함정을 놓고 부하를 세워, 몇 번이고 다시 찾아오는 모험가를 막아내세요. 쓰러뜨린 자는 장비를 남기고, 사로잡은 자는 당신의 편이 됩니다.",
  title_start: "던전 파기 시작",
  title_continue: "이어하기",
  title_loading: "던전을 불러오는 중…",
  title_offline: "로컬 전용 모드입니다. 진행이 저장되지 않습니다.",

  menu_settings: "설정",
  menu_leaderboard: "순위표",
  menu_shop: "상점",
  menu_home: "타이틀로",
  menu_sound_on: "소리 켜기",
  menu_sound_off: "소리 끄기",

  // Intro
  intro_title: "당신은 던전의 관리자입니다",
  intro_1_b: "모험가가 쳐들어옵니다.",
  intro_1: "입구에서 코어까지 최단 경로로 걸어옵니다. 코어에 닿으면 금고를 털립니다.",
  intro_2_b: "길은 당신이 팝니다.",
  intro_2: "통로를 길게 돌리면 함정과 부하가 붙을 시간이 늘어납니다. 대신 굴착 비용이 듭니다.",
  intro_3_b: "쓰러뜨린 자는 돌아옵니다.",
  intro_3:
    "레벨을 올려서. 죽이면 장비를 남기고, 감옥에 가두면 시간이 지나 당신의 부하가 됩니다.",
  intro_note:
    "게임 오버는 없습니다. 돌파당해도 잃는 것은 골드와 시간뿐이고, 던전과 부하는 그대로 남습니다.",
  intro_go: "던전을 파러 갑니다",

  // Settings
  settings_sound: "소리",
  settings_on: "켜짐",
  settings_off: "꺼짐",
  settings_quality: "그래픽 품질",
  settings_quality_high: "높음",
  settings_quality_low: "낮음 (성능 우선)",
  settings_quality_note:
    "낮음은 렌더 해상도를 1배로 고정합니다. 모바일에서 프레임이 떨어질 때 쓰세요.",
  settings_language: "언어",
  settings_tutorial: "튜토리얼",
  settings_replay: "다시 보기",
  settings_reset: "던전 초기화",
  settings_reset_action: "초기화",
  settings_reset_note: "던전 구조·부하·연구가 모두 사라집니다. 되돌릴 수 없습니다.",

  // HUD
  tab_build: "건설",
  tab_manage: "관리",
  tab_research: "연구",
  stat_threat: "위협도",
  stat_unsaved: "미저장",
  save_now: "지금 저장",
  start_raid: "침입 시작",
  preparing: "준비 중…",
  need_path: "입구에서 코어까지 길이 이어져야 합니다.",
  unsaved_changes: "저장하지 않은 변경이 있습니다.",
  hover_hint: "타일 위에 커서를 올려보세요",
  tile: "타일",
  pending_digs: "굴착 대기",
  saved_at: "저장",
  controls: "드래그 팬 · 휠/핀치 줌 · Q/E 90° 회전",

  hint_dig: "암반 타일을 클릭하면 통로가 됩니다.",
  hint_remove: "타일 위의 부하 · 함정 · 방을 회수합니다. 환불은 없습니다.",
  hint_minion: "통로 타일에 배치합니다.",
  hint_trap: "통로 타일에 설치합니다.",
  hint_room: "2×2 통로가 필요합니다.",
  hint_skill_target: "대상 타일을 선택하세요.",

  count_minions: "부하",
  count_traps: "함정",
  count_rooms: "방",
  count_jail: "감옥",
  free: "무료",
  locked_hint: "연구로 해금해야 합니다",

  // Raid
  raiding: "침입 중",
  raid_adventurers: "모험가",
  raid_minions: "부하",
  raid_traps: "함정",
  seconds: "초",
  skill_ready: "사용 가능",
  skill_target: "대상 지정",
  ad_revive: "부하 부활",
  ad_playing: "광고 재생 중…",
  ad_watch: "광고 시청",
  ad_revived: "부하 {n}기가 다시 일어섰습니다",
  ad_not_watched: "광고를 끝까지 봐야 부활합니다",

  // Result
  result_repelled: "격퇴 성공",
  result_breached: "코어 돌파당함",
  result_repelled_note: "모험가들이 물러났습니다. 다음에는 더 강해져서 돌아옵니다.",
  result_breached_note: "코어가 털렸습니다. 던전 구조와 부하는 그대로 남아 있습니다.",
  result_local:
    "로컬 전용 모드라 보상과 기록이 반영되지 않습니다. 배포 후에는 골드·위협도·누적 전적이 서버에 저장됩니다.",
  result_captured: "생포",
  result_captured_note: "감옥에서 전향을 기다립니다.",
  result_loot: "노획",
  result_reward: "보상",
  result_plundered: "약탈당한 골드",
  result_waves: "누적 격퇴",
  result_breaches: "누적 돌파",

  // Manage
  manage_empty: "아직 관리할 것이 없습니다. 침입을 한 번 막아보세요.",
  manage_loot: "노획 장비",
  manage_none: "없음",
  manage_jail: "감옥",
  manage_nemesis: "숙적",
  state_jailed: "감옥",
  state_converted: "전향함",
  state_waiting: "대기 중",
  returns_in: "{t} 후 재도전",
  converts_in: "전향까지 {t}",
  soon: "곧",
  minutes: "{n}분",
  times: "{n}회",

  // Research
  research_owned: "보유",
  research_requires: "선행",
  err_gold: "골드가 부족합니다.",
  err_prereq: "선행 연구가 필요합니다.",
  err_done: "이미 연구했습니다.",

  // Leaderboard
  board_title: "순위표",
  board_note:
    "한 판 기록이 아니라 누적 격퇴 횟수 순위입니다. 등록은 선택이며, 등록하지 않아도 게임 진행에는 영향이 없습니다.",
  board_name: "표시할 이름",
  board_submit: "등록",
  board_update: "갱신",
  board_loading: "불러오는 중…",
  board_empty: "아직 등록된 던전이 없습니다.",
  board_offline: "배포 후에 순위표가 활성화됩니다.",
  board_rank: "#",
  board_player: "이름",
  board_repelled: "격퇴",
  board_breaches: "돌파",
  board_converts: "전향",
  board_mine: "내 기록",

  // Shop
  shop_title: "상점",
  shop_owned: "보유 중",
  shop_offline: "아직 배포되지 않아 상점을 불러올 수 없습니다.",
  shop_empty: "등록된 상품이 없습니다.",
  shop_loading: "상품 불러오는 중…",
  shop_ads_removed: "광고 제거가 적용되어 있습니다.",

  // Status
  status_connecting: "서버 연결 중",
  status_loading: "세이브 불러오는 중",
  status_ready: "저장됨",
  status_saving: "저장 중",
  status_offline: "로컬 전용 (미배포)",
  status_error: "오류",
  save_error: "저장 오류",
  raid_error: "침입 오류",
  err_no_save: "세이브를 찾을 수 없습니다.",
  err_no_adventurers: "지금은 쳐들어올 모험가가 없습니다. 잠시 후 다시 시도하세요.",

  // Tutorial
  tut_dig_title: "길을 파세요",
  tut_dig_body:
    "암반 타일을 클릭하면 통로가 됩니다. 입구(초록)에서 코어(주황)까지 길이 이어져야 모험가가 들어옵니다.",
  tut_minion_title: "부하를 세우세요",
  tut_minion_body:
    "스켈레톤 워리어를 통로에 배치하면 모험가를 붙잡아 둡니다. 함정은 붙잡아 둘 상대가 있어야 값어치를 합니다.",
  tut_trap_title: "함정을 놓으세요",
  tut_trap_body:
    "가시 함정을 부하 근처 통로에 설치하세요. 부하가 시간을 벌고 함정이 피해를 쌓는 조합이 기본입니다.",
  tut_save_title: "저장하세요",
  tut_save_body:
    "변경 사항은 저장해야 서버에 반영됩니다. 침입은 저장된 던전으로만 시작할 수 있습니다.",
  tut_raid_title: "침입을 시작하세요",
  tut_raid_body:
    "모험가가 입구에서 코어로 향합니다. 전투는 자동이며, 워든 스킬 3개와 배속으로 개입합니다.",

  // Research nodes
  res_mage: "강령술",
  res_mage_n: "스켈레톤 메이지 해금",
  res_trap_arrow: "기계 장치",
  res_trap_arrow_n: "화살 함정 해금",
  res_trap_rock: "굴착 공학",
  res_trap_rock_n: "낙석 함정 해금",
  res_trap_flame: "지옥불",
  res_trap_flame_n: "화염 함정 해금",
  res_room_barracks: "병영 설계",
  res_room_barracks_n: "병영 해금",
  res_room_vault: "금고 설계",
  res_room_vault_n: "창고 해금",
  res_room_workshop: "작업장 설계",
  res_room_workshop_n: "작업장 해금",
  res_room_altar: "제단 의식",
  res_room_altar_n: "제단 해금",
  res_room_jail: "구속 의식",
  res_room_jail_n: "감옥 해금 — 생포가 가능해집니다",
  res_might1: "뼈 단련 I",
  res_might1_n: "부하 공격력 +10%",
  res_might2: "뼈 단련 II",
  res_might2_n: "부하 공격력 +20%",
  res_vigor1: "불사의 살점 I",
  res_vigor1_n: "부하 체력 +15%",
  res_vigor2: "불사의 살점 II",
  res_vigor2_n: "부하 체력 +30%",
  res_tp1: "정밀 격발 I",
  res_tp1_n: "함정 피해 +20%",
  res_tp2: "정밀 격발 II",
  res_tp2_n: "함정 피해 +40%",
  res_expand1: "심층 굴착 I",
  res_expand1_n: "던전 폭 12 → 16, 코어가 더 깊어집니다",
  res_expand2: "심층 굴착 II",
  res_expand2_n: "던전 폭 16 → 20",

  // Content names
  minion_warrior: "스켈레톤 워리어",
  minion_mage: "스켈레톤 메이지",
  minion_convert: "전향한 모험가",
  trap_spike: "가시 함정",
  trap_arrow: "화살 함정",
  trap_rockfall: "낙석 함정",
  trap_flame: "화염 함정",
  room_treasury: "보물방",
  room_vault: "창고",
  room_barracks: "병영",
  room_altar: "제단",
  room_workshop: "작업장",
  room_jail: "감옥",
  room_treasury_desc: "침입자를 끌어들이고 격퇴 시 추가 골드. 위협도가 오릅니다.",
  room_vault_desc: "돌파당했을 때 약탈량 감소.",
  room_barracks_desc: "부하 배치 한도 +2.",
  room_altar_desc: "쓰러진 부하의 부활 대기 단축.",
  room_workshop_desc: "함정 재장전 속도 증가.",
  room_jail_desc: "제압한 모험가를 생포해 가둡니다. 시간이 지나면 내 편이 됩니다.",
  skill_blessing: "어둠의 가호",
  skill_rally: "집결",
  skill_detonate: "강제 발동",
  tool_dig: "굴착",
  tool_remove: "회수",
  legend_rock: "암반",
  legend_floor: "통로",
  legend_entrance: "입구",
  legend_core: "코어",
  weapon: "무기",
  adv_knight: "기사",
  adv_barbarian: "바바리안",
  adv_rogue: "로그",
  adv_mage: "메이지",
  adv_ranger: "레인저",
  banner_offline:
    "아직 배포되지 않아 VITE_AGENT8_VERSE가 없습니다. 로컬 전용 모드로 실행 중이며 진행이 저장되지 않습니다. npx -y @agent8/deploy 로 배포한 뒤 다시 열면 세이브가 붙습니다.",
};

export type StringKey = keyof typeof ko;

const en: Record<StringKey, string> = {
  title_kicker: "Be the dungeon, not the hero",
  title_line:
    "Dig the corridors, set the traps, post your minions, and turn back adventurers who keep coming back for more. The fallen leave their gear; the captured become yours.",
  title_start: "Start digging",
  title_continue: "Continue",
  title_loading: "Loading your dungeon…",
  title_offline: "Running locally. Progress is not saved.",

  menu_settings: "Settings",
  menu_leaderboard: "Rankings",
  menu_shop: "Shop",
  menu_home: "Title screen",
  menu_sound_on: "Unmute",
  menu_sound_off: "Mute",

  intro_title: "You are the dungeon keeper",
  intro_1_b: "Adventurers come for you.",
  intro_1: "They walk the shortest path from the entrance to your core. Reach it, and they rob you.",
  intro_2_b: "You dig the path.",
  intro_2:
    "A longer corridor gives your traps and minions more time to work — and costs more to excavate.",
  intro_3_b: "Whoever falls comes back.",
  intro_3:
    "Stronger. Kill them and they drop their gear; jail them and they eventually fight for you.",
  intro_note:
    "There is no game over. A breach costs gold and time — your dungeon and your minions stay.",
  intro_go: "Start digging",

  settings_sound: "Sound",
  settings_on: "On",
  settings_off: "Off",
  settings_quality: "Graphics",
  settings_quality_high: "High",
  settings_quality_low: "Low (performance)",
  settings_quality_note:
    "Low pins render resolution to 1x. Use it if the frame rate drops on mobile.",
  settings_language: "Language",
  settings_tutorial: "Tutorial",
  settings_replay: "Replay",
  settings_reset: "Reset dungeon",
  settings_reset_action: "Reset",
  settings_reset_note: "Layout, minions and research are all lost. This cannot be undone.",

  tab_build: "Build",
  tab_manage: "Manage",
  tab_research: "Research",
  stat_threat: "Threat",
  stat_unsaved: "Unsaved",
  save_now: "Save now",
  start_raid: "Start raid",
  preparing: "Preparing…",
  need_path: "A path must connect the entrance to the core.",
  unsaved_changes: "You have unsaved changes.",
  hover_hint: "Hover a tile to inspect it",
  tile: "Tile",
  pending_digs: "pending digs",
  saved_at: "saved",
  controls: "Drag to pan · wheel/pinch to zoom · Q/E to rotate",

  hint_dig: "Click solid rock to carve a corridor.",
  hint_remove: "Removes the minion, trap or room on a tile. No refund.",
  hint_minion: "Place on a corridor tile.",
  hint_trap: "Set on a corridor tile.",
  hint_room: "Needs a clear 2×2 of corridor.",
  hint_skill_target: "Pick a target tile.",

  count_minions: "Minions",
  count_traps: "Traps",
  count_rooms: "Rooms",
  count_jail: "Jail",
  free: "Free",
  locked_hint: "Unlock this with research",

  raiding: "Raid in progress",
  raid_adventurers: "Adventurers",
  raid_minions: "Minions",
  raid_traps: "Trap damage",
  seconds: "s",
  skill_ready: "Ready",
  skill_target: "Pick a tile",
  ad_revive: "Revive minions",
  ad_playing: "Playing ad…",
  ad_watch: "Watch an ad",
  ad_revived: "{n} minion(s) got back up",
  ad_not_watched: "Watch the ad through to revive them",

  result_repelled: "Raid repelled",
  result_breached: "Core breached",
  result_repelled_note: "They pulled back. They will return stronger.",
  result_breached_note: "Your core was robbed. The dungeon and your minions remain.",
  result_local:
    "Running locally, so rewards and records are not applied. Once deployed, gold, threat and totals are saved on the server.",
  result_captured: "Captured",
  result_captured_note: "Awaiting conversion in the jail.",
  result_loot: "Loot",
  result_reward: "Reward",
  result_plundered: "Gold plundered",
  result_waves: "Total repelled",
  result_breaches: "Total breaches",

  manage_empty: "Nothing to manage yet. Survive a raid first.",
  manage_loot: "Looted weapons",
  manage_none: "None",
  manage_jail: "Jail",
  manage_nemesis: "Nemeses",
  state_jailed: "Jailed",
  state_converted: "Converted",
  state_waiting: "Ready",
  returns_in: "returns in {t}",
  converts_in: "converts in {t}",
  soon: "soon",
  minutes: "{n}m",
  times: "{n} raids",

  research_owned: "Owned",
  research_requires: "Requires",
  err_gold: "Not enough gold.",
  err_prereq: "A prerequisite is missing.",
  err_done: "Already researched.",

  board_title: "Rankings",
  board_note:
    "Ranked by total raids repelled, not a single run. Entering is optional and does not affect play.",
  board_name: "Display name",
  board_submit: "Enter",
  board_update: "Update",
  board_loading: "Loading…",
  board_empty: "No dungeons ranked yet.",
  board_offline: "Rankings become available after deployment.",
  board_rank: "#",
  board_player: "Name",
  board_repelled: "Repelled",
  board_breaches: "Breached",
  board_converts: "Converts",
  board_mine: "Your record",

  shop_title: "Shop",
  shop_owned: "Owned",
  shop_offline: "Not deployed yet, so the shop cannot load.",
  shop_empty: "No products registered.",
  shop_loading: "Loading products…",
  shop_ads_removed: "Ad removal is active.",

  status_connecting: "Connecting",
  status_loading: "Loading save",
  status_ready: "Saved",
  status_saving: "Saving",
  status_offline: "Local only",
  status_error: "Error",
  save_error: "Save error",
  raid_error: "Raid error",
  err_no_save: "No save found.",
  err_no_adventurers: "No adventurers are available right now. Try again shortly.",

  tut_dig_title: "Dig a path",
  tut_dig_body:
    "Click solid rock to carve a corridor. Adventurers only come once the entrance (green) connects to the core (amber).",
  tut_minion_title: "Post a minion",
  tut_minion_body:
    "A skeleton warrior in the corridor holds adventurers in place. Traps are only worth their cost when something is holding the target still.",
  tut_trap_title: "Set a trap",
  tut_trap_body:
    "Put a spike trap near your minion. One buys time while the other stacks damage — that pairing is the core of every defence.",
  tut_save_title: "Save",
  tut_save_body:
    "Changes reach the server only when saved, and a raid runs against the saved dungeon.",
  tut_raid_title: "Start the raid",
  tut_raid_body:
    "They walk from the entrance toward your core. Combat resolves itself; you intervene with three warden skills and the speed control.",

  res_mage: "Necromancy",
  res_mage_n: "Unlocks the skeleton mage",
  res_trap_arrow: "Clockwork",
  res_trap_arrow_n: "Unlocks the arrow trap",
  res_trap_rock: "Excavation",
  res_trap_rock_n: "Unlocks the rockfall trap",
  res_trap_flame: "Hellfire",
  res_trap_flame_n: "Unlocks the flame trap",
  res_room_barracks: "Barracks Plans",
  res_room_barracks_n: "Unlocks the barracks",
  res_room_vault: "Vault Plans",
  res_room_vault_n: "Unlocks the vault",
  res_room_workshop: "Workshop Plans",
  res_room_workshop_n: "Unlocks the workshop",
  res_room_altar: "Altar Rites",
  res_room_altar_n: "Unlocks the altar",
  res_room_jail: "Binding Rites",
  res_room_jail_n: "Unlocks the jail — you can take prisoners",
  res_might1: "Bone Tempering I",
  res_might1_n: "Minion damage +10%",
  res_might2: "Bone Tempering II",
  res_might2_n: "Minion damage +20%",
  res_vigor1: "Undying Flesh I",
  res_vigor1_n: "Minion health +15%",
  res_vigor2: "Undying Flesh II",
  res_vigor2_n: "Minion health +30%",
  res_tp1: "Precision Triggers I",
  res_tp1_n: "Trap damage +20%",
  res_tp2: "Precision Triggers II",
  res_tp2_n: "Trap damage +40%",
  res_expand1: "Deep Excavation I",
  res_expand1_n: "Dungeon width 12 → 16; the core moves further back",
  res_expand2: "Deep Excavation II",
  res_expand2_n: "Dungeon width 16 → 20",

  minion_warrior: "Skeleton Warrior",
  minion_mage: "Skeleton Mage",
  minion_convert: "Converted adventurer",
  trap_spike: "Spike trap",
  trap_arrow: "Arrow trap",
  trap_rockfall: "Rockfall trap",
  trap_flame: "Flame trap",
  room_treasury: "Treasury",
  room_vault: "Vault",
  room_barracks: "Barracks",
  room_altar: "Altar",
  room_workshop: "Workshop",
  room_jail: "Jail",
  room_treasury_desc: "Lures raiders off the direct route and pays out on a repel. Raises threat.",
  room_vault_desc: "Less gold plundered on a breach.",
  room_barracks_desc: "Minion limit +2.",
  room_altar_desc: "Fallen minions revive sooner.",
  room_workshop_desc: "Traps reload faster.",
  room_jail_desc: "Take beaten adventurers alive. Given time, they fight for you.",
  skill_blessing: "Dark Blessing",
  skill_rally: "Rally",
  skill_detonate: "Force Trigger",
  tool_dig: "Dig",
  tool_remove: "Remove",
  legend_rock: "Rock",
  legend_floor: "Corridor",
  legend_entrance: "Entrance",
  legend_core: "Core",
  weapon: "weapon",
  adv_knight: "Knight",
  adv_barbarian: "Barbarian",
  adv_rogue: "Rogue",
  adv_mage: "Mage",
  adv_ranger: "Ranger",
  banner_offline:
    "Not deployed yet, so VITE_AGENT8_VERSE is missing. Running in local-only mode — progress is not saved. Deploy with npx -y @agent8/deploy and reopen to attach a save.",
};

const TABLES: Record<Locale, Record<StringKey, string>> = { ko, en };

/** Browser language, defaulting to English for anything that is not Korean. */
export function detectLocale(): Locale {
  if (typeof navigator === "undefined") return "en";
  return navigator.language.toLowerCase().startsWith("ko") ? "ko" : "en";
}

/**
 * Looks up a string and fills `{name}` placeholders.
 * Falls back to Korean, then to the key itself, so a gap is visible instead of
 * rendering as blank.
 */
export function translate(
  locale: Locale,
  key: StringKey,
  vars?: Record<string, string | number>,
): string {
  const text = TABLES[locale]?.[key] ?? ko[key] ?? key;
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, name) =>
    vars[name] !== undefined ? String(vars[name]) : match,
  );
}
