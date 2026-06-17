const fallbackState = {
  equipment: [],
  rooms: [],
  members: [],
  requests: [],
};

const PENDING_PROFILE_KEY = "ksmc-pending-profile";

const els = {
  body: document.body,
  serviceBadge: document.querySelector("#serviceBadge"),
  refreshBtn: document.querySelector("#refreshBtn"),
  configWarning: document.querySelector("#configWarning"),
  authPanel: document.querySelector("#authPanel"),
  sessionPanel: document.querySelector("#sessionPanel"),
  currentUser: document.querySelector("#currentUser"),
  authEmail: document.querySelector("#authEmail"),
  authPassword: document.querySelector("#authPassword"),
  loginBtn: document.querySelector("#loginBtn"),
  signupBtn: document.querySelector("#signupBtn"),
  logoutBtn: document.querySelector("#logoutBtn"),
  roleSelect: document.querySelector("#roleSelect"),
  studentProfile: document.querySelector("#studentProfile"),
  studentName: document.querySelector("#studentName"),
  studentId: document.querySelector("#studentId"),
  teamName: document.querySelector("#teamName"),
  navItems: document.querySelectorAll(".nav-item"),
  views: document.querySelectorAll(".view"),
  equipmentGrid: document.querySelector("#equipmentGrid"),
  equipmentSelect: document.querySelector("#equipmentSelect"),
  equipmentForm: document.querySelector("#equipmentForm"),
  equipmentQty: document.querySelector("#equipmentQty"),
  equipmentStart: document.querySelector("#equipmentStart"),
  equipmentReturn: document.querySelector("#equipmentReturn"),
  equipmentPurpose: document.querySelector("#equipmentPurpose"),
  roomGrid: document.querySelector("#roomGrid"),
  roomSelect: document.querySelector("#roomSelect"),
  roomForm: document.querySelector("#roomForm"),
  roomDate: document.querySelector("#roomDate"),
  roomStart: document.querySelector("#roomStart"),
  roomEnd: document.querySelector("#roomEnd"),
  roomPurpose: document.querySelector("#roomPurpose"),
  requestList: document.querySelector("#requestList"),
  adminRequestList: document.querySelector("#adminRequestList"),
  memberList: document.querySelector("#memberList"),
  memberForm: document.querySelector("#memberForm"),
  memberName: document.querySelector("#memberName"),
  memberId: document.querySelector("#memberId"),
  memberEmail: document.querySelector("#memberEmail"),
  memberRole: document.querySelector("#memberRole"),
  pendingCount: document.querySelector("#pendingCount"),
  approvedCount: document.querySelector("#approvedCount"),
  memberCount: document.querySelector("#memberCount"),
  toast: document.querySelector("#toast"),
};

let db = null;
let session = null;
let profile = null;
let state = structuredClone(fallbackState);
let currentView = "equipment";
let statusFilter = "all";
let gradeFilter = "all";

function today() {
  return new Date().toISOString().slice(0, 10);
}

function isServiceOpen() {
  return true;
}

function isAdmin() {
  return profile?.role === "admin" && profile?.approved;
}

function isApprovedStudent() {
  return Boolean(profile?.approved);
}

function getApplicant() {
  return {
    applicant: profile?.name || els.studentName.value.trim() || "이름 없음",
    studentId: profile?.student_id || els.studentId.value.trim() || "학번 없음",
    team: profile?.team_name || els.teamName.value.trim() || "개인",
  };
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  window.setTimeout(() => els.toast.classList.remove("show"), 2400);
}

function setLoading(isLoading) {
  [
    els.loginBtn,
    els.signupBtn,
    els.logoutBtn,
    els.refreshBtn,
    els.equipmentForm.querySelector("button"),
    els.roomForm.querySelector("button"),
  ].forEach((button) => {
    if (button) button.disabled = isLoading;
  });
}

async function getConfig() {
  if (window.KSMC_SUPABASE_CONFIG?.supabaseUrl && window.KSMC_SUPABASE_CONFIG?.supabaseAnonKey) {
    return window.KSMC_SUPABASE_CONFIG;
  }

  try {
    const response = await fetch("/api/config");
    if (!response.ok) throw new Error("Config endpoint unavailable");
    const config = await response.json();
    if (config.supabaseUrl && config.supabaseAnonKey) return config;
  } catch {
    return null;
  }

  return null;
}

async function initSupabase() {
  const config = await getConfig();
  if (!config) {
    els.configWarning.textContent = "Supabase 설정이 필요합니다.";
    renderSignedOut();
    renderAll();
    return;
  }

  els.configWarning.textContent = "";
  db = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);

  // 세션 체크
  const { data: { session: initialSession } } = await db.auth.getSession();
  session = initialSession;

  // 인증 상태 변화 리스너
  db.auth.onAuthStateChange(async (_event, nextSession) => {
    session = nextSession;
    // 상태가 변할 때(로그인/로그아웃) 반드시 데이터를 새로 불러옴
    await loadAppData();
  });

  // 초기 데이터 로드
  await loadAppData();
}

async function loadProfile() {
  profile = null;
  if (!session?.user) return;

  const { data, error } = await db
    .from("members")
    .select("*")
    .eq("auth_id", session.user.id)
    .maybeSingle();

  if (error) throw error;
  profile = data;

  if (!profile) {
    profile = await createPendingProfile();
  }
}

async function createPendingProfile() {
  const stored = localStorage.getItem(PENDING_PROFILE_KEY);
  const pending = stored ? JSON.parse(stored) : null;
  const email = session.user.email;

  if (!pending || pending.email !== email) return null;

  const { data, error } = await db
    .from("members")
    .insert({
      auth_id: session.user.id,
      email,
      name: pending.name,
      student_id: pending.studentId,
      team_name: pending.teamName,
      role: "student",
      approved: false,
    })
    .select()
    .single();

  if (error) throw error;
  localStorage.removeItem(PENDING_PROFILE_KEY);
  return data;
}

async function loadAppData() {
  if (!db) return;

  setLoading(true);
  try {
    await loadProfile();

    if (!session) {
      state = structuredClone(fallbackState);
      renderSignedOut();
      renderAll();
      return;
    }

    const [equipmentResult, roomsResult, requestsResult, membersResult] = await Promise.all([
      db.from("equipment").select("*").order("name", { ascending: true }),
      db.from("rooms").select("*").order("name", { ascending: true }),
      db
        .from("rental_requests")
        .select("*, equipment:equipment_id(name), room:room_id(name)")
        .order("created_at", { ascending: false }),
      isAdmin()
        ? db.from("members").select("*").order("created_at", { ascending: false })
        : Promise.resolve({ data: profile ? [profile] : [], error: null }),
    ]);

    const errors = [equipmentResult, roomsResult, requestsResult, membersResult].map((result) => result.error).filter(Boolean);
    if (errors.length) throw errors[0];

    state = {
      equipment: equipmentResult.data || [],
      rooms: roomsResult.data || [],
      requests: normalizeRequests(requestsResult.data || []),
      members: membersResult.data || [],
    };

    renderSignedIn();
    renderAll();
  } catch (error) {
    showToast(error.message || "데이터를 불러오지 못했습니다.");
  } finally {
    setLoading(false);
    renderServiceState();
  }
}

function normalizeRequests(rows) {
  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    itemId: row.equipment_id,
    roomId: row.room_id,
    itemName: row
