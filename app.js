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
    els.configWarning.textContent = "Supabase 설정이 필요합니다. README의 Vercel 환경변수 설정을 확인하세요.";
    renderSignedOut();
    renderAll();
    return;
  }

  if (!window.supabase?.createClient) {
    els.configWarning.textContent = "Supabase 라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인하세요.";
    renderSignedOut();
    renderAll();
    return;
  }

  els.configWarning.textContent = "";
  db = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);

  const { data } = await db.auth.getSession();
  session = data.session;

  db.auth.onAuthStateChange(async (_event, nextSession) => {
    session = nextSession;
    await loadAppData();
  });

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
    itemName: row.equipment?.name || row.room?.name || "삭제된 항목",
    quantity: row.quantity,
    startDate: row.start_date,
    returnDate: row.return_date,
    date: row.usage_date,
    startTime: row.start_time?.slice(0, 5),
    endTime: row.end_time?.slice(0, 5),
    applicant: row.applicant_name,
    studentId: row.student_id,
    team: row.team_name,
    purpose: row.purpose,
    status: row.status,
    createdAt: row.created_at,
    applicantAuthId: row.applicant_auth_id,
  }));
}

function renderSignedOut() {
  els.authPanel.style.display = "grid";
  els.sessionPanel.style.display = "none";
  els.currentUser.textContent = "";
  els.roleSelect.value = "student";
  els.body.classList.remove("is-admin");
  els.studentProfile.style.display = "grid";
}

function renderSignedIn() {
  els.authPanel.style.display = "none";
  els.sessionPanel.style.display = "grid";
  const label = profile
    ? `${profile.name} · ${profile.approved ? (profile.role === "admin" ? "관리자" : "승인 회원") : "승인 대기"}`
    : `${session.user.email} · 프로필 미등록`;
  els.currentUser.textContent = label;

  if (profile) {
    els.studentName.value = profile.name || "";
    els.studentId.value = profile.student_id || "";
    els.teamName.value = profile.team_name || "";
  }
}

function setDefaultDates() {
  const date = today();
  els.equipmentStart.value = date;
  els.equipmentReturn.value = date;
  els.roomDate.value = date;
}

function renderServiceState() {
  const open = isServiceOpen();
  const canApply = open && Boolean(session) && isApprovedStudent();
  els.serviceBadge.textContent = open ? "신청 가능" : "신청 마감";
  els.serviceBadge.classList.toggle("closed", !open);
  els.equipmentForm.querySelector("button").disabled = !canApply;
  els.roomForm.querySelector("button").disabled = !canApply;
}

function renderRole() {
  const admin = isAdmin();
  els.roleSelect.value = admin ? "admin" : "student";
  els.body.classList.toggle("is-admin", admin);
  els.studentProfile.style.display = admin ? "none" : "grid";
  if (!admin && currentView === "admin") setView("equipment");
}

function setView(view) {
  currentView = view;
  els.navItems.forEach((item) => item.classList.toggle("active", item.dataset.view === view));
  els.views.forEach((viewEl) => viewEl.classList.toggle("active-view", viewEl.id === `${view}View`));
}

function stockClass(count) {
  if (count <= 0) return "empty";
  if (count <= 2) return "low";
  return "";
}

function approvedEquipmentQuantity(equipmentId) {
  return state.requests
    .filter((request) => request.type === "equipment")
    .filter((request) => request.itemId === equipmentId)
    .filter((request) => request.status === "approved")
    .reduce((sum, request) => sum + Number(request.quantity), 0);
}

function availableEquipment(item) {
  if (!item) return 0;
  const totalCount = Number(item.total || item.total_qty || 0);
  return totalCount - approvedEquipmentQuantity(item.id);
}

function renderEquipment() {
  els.equipmentGrid.innerHTML = state.equipment.length
    ? state.equipment
        .map((item) => {
          const available = availableEquipment(item);
          return `
            <article class="item-card">
              <div class="meta-row"><span>${escapeHtml(item.category)}</span><span>총 ${item.total}개</span></div>
              <strong>${escapeHtml(item.name)}</strong>
              <span class="stock ${stockClass(available)}">대여 가능 ${available}개</span>
            </article>
          `;
        })
        .join("")
    : `<div class="empty-state">로그인 후 기자재 목록을 불러옵니다.</div>`;

  els.equipmentSelect.innerHTML = state.equipment
    .map((item) => `<option value="${item.id}">${escapeHtml(item.name)} (${availableEquipment(item)}개 가능)</option>`)
    .join("");
}

function roomReservations(roomId) {
  return state.requests
    .filter((request) => request.type === "room")
    .filter((request) => request.roomId === roomId)
    .filter((request) => request.status === "approved" || request.status === "pending")
    .sort((a, b) => `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`));
}

function renderRooms() {
  els.roomGrid.innerHTML = state.rooms.length
    ? state.rooms
        .map((room) => {
          const reservations = roomReservations(room.id).slice(0, 3);
          const rows = reservations.length
            ? reservations.map((request) => `<p>${request.date} ${request.startTime}-${request.endTime} · ${escapeHtml(request.team)}</p>`).join("")
            : "<p>예정된 예약 없음</p>";

          return `
            <article class="room-card">
              <div class="meta-row"><span>${escapeHtml(room.location)}</span><span>${room.capacity}명</span></div>
              <strong>${escapeHtml(room.name)}</strong>
              <div>${rows}</div>
            </article>
          `;
        })
        .join("")
    : `<div class="empty-state">로그인 후 강의실 목록을 불러옵니다.</div>`;

  els.roomSelect.innerHTML = state.rooms.map((room) => `<option value="${room.id}">${escapeHtml(room.name)}</option>`).join("");
}

function statusLabel(status) {
  return {
    pending: "승인 대기",
    approved: "승인 완료",
    returned: "반납 완료",
    rejected: "반려",
  }[status];
}

function typeLabel(type) {
  return type === "equipment" ? "기자재" : "강의실";
}

function requestSummary(request) {
  if (request.type === "equipment") {
    return `${request.quantity}개 · ${request.startDate} 대여 · ${request.returnDate} 반납 예정`;
  }

  return `${request.date} ${request.startTime}-${request.endTime}`;
}

function renderRequestCard(request, admin = false) {
  const actions = admin
    ? `
      <div class="card-actions">
        ${request.status === "pending" ? `<button class="small-button approve" data-action="approve" data-id="${request.id}" type="button">승인</button>` : ""}
        ${request.status === "pending" ? `<button class="small-button reject" data-action="reject" data-id="${request.id}" type="button">반려</button>` : ""}
        ${request.status === "approved" ? `<button class="small-button" data-action="return" data-id="${request.id}" type="button">반납</button>` : ""}
      </div>
    `
    : "";

  return `
    <article class="request-card">
      <div>
        <span class="status ${request.status}">${statusLabel(request.status)}</span>
        <h4>${typeLabel(request.type)} · ${escapeHtml(request.itemName)}</h4>
        <p>${escapeHtml(requestSummary(request))}</p>
        <p>${escapeHtml(request.applicant)} (${escapeHtml(request.studentId)}) · ${escapeHtml(request.team)}</p>
        <p>${escapeHtml(request.purpose)}</p>
      </div>
      ${actions}
    </article>
  `;
}

function renderRequests() {
  const visibleRequests = state.requests
    .filter((request) => statusFilter === "all" || request.status === statusFilter)
    .filter((request) => isAdmin() || request.applicantAuthId === session?.user?.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  els.requestList.innerHTML = visibleRequests.length
    ? visibleRequests.map((request) => renderRequestCard(request)).join("")
    : `<div class="empty-state">표시할 신청 내역이 없습니다.</div>`;
}

function renderAdmin() {
  const sortedRequests = [...state.requests].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  els.adminRequestList.innerHTML = sortedRequests.length
    ? sortedRequests.map((request) => renderRequestCard(request, true)).join("")
    : `<div class="empty-state">접수된 신청이 없습니다.</div>`;

  els.pendingCount.textContent = state.requests.filter((request) => request.status === "pending").length;
  els.approvedCount.textContent = state.requests.filter((request) => request.status === "approved").length;
  els.memberCount.textContent = state.members.filter((member) => member.approved).length;

  els.memberList.innerHTML = state.members.length
    ? state.members
        .map(
          (member) => `
            <article class="member-card">
              <p>
                <strong>${escapeHtml(member.name)}</strong><br />
                ${escapeHtml(member.student_id)} · ${escapeHtml(member.email)}<br />
                ${member.approved ? "승인" : "대기"} · ${member.role === "admin" ? "관리자" : "학생"}
              </p>
              <div class="card-actions">
                ${
                  member.approved
                    ? `<button class="small-button reject" data-action="unapprove-member" data-id="${member.id}" type="button">승인취소</button>`
                    : `<button class="small-button approve" data-action="approve-member" data-id="${member.id}" type="button">승인</button>`
                }
                <button class="small-button reject" data-action="remove-member" data-id="${member.id}" type="button">삭제</button>
              </div>
            </article>
          `,
        )
        .join("")
    : `<div class="empty-state">등록된 회원이 없습니다.</div>`;
}

function renderAll() {
  renderRole();
  renderEquipment();
  renderRooms();
  renderRequests();
  renderAdmin();
  renderServiceState();
}

function assertStudentCanApply() {
  if (!session) {
    showToast("로그인 후 신청할 수 있습니다.");
    return false;
  }

  if (!profile) {
    showToast("회원가입 프로필을 먼저 생성해야 합니다.");
    return false;
  }

  if (!isApprovedStudent()) {
    showToast("관리자 승인 후 신청할 수 있습니다.");
    return false;
  }

  if (!isServiceOpen()) {
    showToast("16시 이후에는 신청서를 작성할 수 없습니다.");
    return false;
  }

  return true;
}

function hasRoomConflict(roomId, date, startTime, endTime) {
  return state.requests
    .filter((request) => request.type === "room")
    .filter((request) => request.roomId === roomId && request.date === date)
    .filter((request) => request.status === "approved" || request.status === "pending")
    .some((request) => startTime < request.endTime && endTime > request.startTime);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function login() {
  if (!db) {
    showToast("Supabase 설정이 필요합니다.");
    return;
  }

  const email = els.authEmail.value.trim();
  const password = els.authPassword.value;
  const { error } = await db.auth.signInWithPassword({ email, password });
  if (error) {
    showToast(error.message);
    return;
  }

  showToast("로그인되었습니다.");
}

async function signup() {
  if (!db) {
    showToast("Supabase 설정이 필요합니다.");
    return;
  }

  const email = els.authEmail.value.trim();
  const password = els.authPassword.value;
  const name = els.studentName.value.trim();
  const studentId = els.studentId.value.trim();
  const teamName = els.teamName.value.trim();

  if (!email || !password || !name || !studentId) {
    showToast("이메일, 비밀번호, 이름, 학번을 입력하세요.");
    return;
  }

  const { data, error } = await db.auth.signUp({ email, password });
  if (error) {
    showToast(error.message);
    return;
  }

  localStorage.setItem(
    PENDING_PROFILE_KEY,
    JSON.stringify({
      email,
      name,
      studentId,
      teamName,
    }),
  );

  const user = data.user;
  if (!user || !data.session) {
    showToast("인증 메일을 확인한 뒤 다시 로그인하세요.");
    return;
  }

  const { error: profileError } = await db.from("members").insert({
    auth_id: user.id,
    email,
    name,
    student_id: studentId,
    team_name: teamName,
    role: "student",
    approved: false,
  });

  if (profileError) {
    showToast(profileError.message);
    return;
  }

  localStorage.removeItem(PENDING_PROFILE_KEY);
  showToast("회원가입 완료. 관리자 승인 후 신청할 수 있습니다.");
  await loadAppData();
}

async function logout() {
  if (!db) return;
  await db.auth.signOut();
  session = null;
  profile = null;
  state = structuredClone(fallbackState);
  renderSignedOut();
  renderAll();
  showToast("로그아웃되었습니다.");
}

async function updateRequestStatus(id, status) {
  const { error } = await db.from("rental_requests").update({ status }).eq("id", id);
  if (error) {
    showToast(error.message);
    return;
  }

  await loadAppData();
  showToast("신청 상태가 업데이트되었습니다.");
}

async function updateMember(id, values) {
  const { error } = await db.from("members").update(values).eq("id", id);
  if (error) {
    showToast(error.message);
    return;
  }

  await loadAppData();
  showToast("회원 정보가 업데이트되었습니다.");
}

async function removeMember(id) {
  const { error } = await db.from("members").delete().eq("id", id);
  if (error) {
    showToast(error.message);
    return;
  }

  await loadAppData();
  showToast("회원이 삭제되었습니다.");
}

els.navItems.forEach((item) => {
  item.addEventListener("click", () => setView(item.dataset.view));
});

document.querySelectorAll("[data-status-filter]").forEach((button) => {
  button.addEventListener("click", () => {
    statusFilter = button.dataset.statusFilter;
    document.querySelectorAll("[data-status-filter]").forEach((item) => item.classList.toggle("active", item === button));
    renderRequests();
  });
});

els.loginBtn.addEventListener("click", login);
els.signupBtn.addEventListener("click", signup);
els.logoutBtn.addEventListener("click", logout);
els.refreshBtn.addEventListener("click", loadAppData);

els.equipmentForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!assertStudentCanApply()) return;

  const equipment = state.equipment.find((item) => Number(item.id) === Number(els.equipmentSelect.value));
  const quantity = Number(els.equipmentQty.value);
  const applicant = getApplicant();

  if (!equipment) {
    showToast("기자재를 선택하세요.");
    return;
  }

  if (quantity < 1 || quantity > availableEquipment(equipment)) {
    showToast("신청 수량이 대여 가능 수량을 초과했습니다.");
    return;
  }

  if (els.equipmentReturn.value < els.equipmentStart.value) {
    showToast("반납 예정일은 대여일 이후여야 합니다.");
    return;
  }

  const { error } = await db.from("rental_requests").insert({
    type: "equipment",
    equipment_id: equipment.id,
    quantity,
    start_date: els.equipmentStart.value,
    return_date: els.equipmentReturn.value,
    purpose: els.equipmentPurpose.value.trim(),
    applicant_auth_id: session.user.id,
    applicant_name: applicant.applicant,
    student_id: applicant.studentId,
    team_name: applicant.team,
  });

  if (error) {
    showToast(error.message);
    return;
  }

  els.equipmentPurpose.value = "";
  await loadAppData();
  showToast("기자재 신청이 접수되었습니다.");
});

els.roomForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!assertStudentCanApply()) return;

  const room = state.rooms.find((item) => item.id === els.roomSelect.value);
  const date = els.roomDate.value;
  const startTime = els.roomStart.value;
  const endTime = els.roomEnd.value;
  const applicant = getApplicant();

  if (!room) {
    showToast("강의실을 선택하세요.");
    return;
  }

  if (startTime >= endTime) {
    showToast("종료 시간은 시작 시간 이후여야 합니다.");
    return;
  }

  if (hasRoomConflict(room.id, date, startTime, endTime)) {
    showToast("이미 예약된 시간대입니다.");
    return;
  }

  const { error } = await db.from("rental_requests").insert({
    type: "room",
    room_id: room.id,
    usage_date: date,
    start_time: startTime,
    end_time: endTime,
    purpose: els.roomPurpose.value.trim(),
    applicant_auth_id: session.user.id,
    applicant_name: applicant.applicant,
    student_id: applicant.studentId,
    team_name: applicant.team,
  });

  if (error) {
    showToast(error.message);
    return;
  }

  els.roomPurpose.value = "";
  await loadAppData();
  showToast("강의실 신청이 접수되었습니다.");
});

els.adminRequestList.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const request = state.requests.find((item) => item.id === button.dataset.id);
  if (!request) return;

  if (button.dataset.action === "approve" && request.type === "equipment") {
    const item = state.equipment.find((equipment) => equipment.id === request.itemId);
    if (request.quantity > availableEquipment(item)) {
      showToast("재고가 부족하여 승인할 수 없습니다.");
      return;
    }
  }

  const status = {
    approve: "approved",
    reject: "rejected",
    return: "returned",
  }[button.dataset.action];

  if (status) await updateRequestStatus(request.id, status);
});

els.memberForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const { error } = await db.from("members").insert({
    email: els.memberEmail.value.trim(),
    name: els.memberName.value.trim(),
    student_id: els.memberId.value.trim(),
    role: els.memberRole.value,
    approved: true,
  });

  if (error) {
    showToast(error.message);
    return;
  }

  els.memberForm.reset();
  await loadAppData();
  showToast("회원이 등록되었습니다.");
});

els.memberList.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  if (button.dataset.action === "approve-member") await updateMember(button.dataset.id, { approved: true });
  if (button.dataset.action === "unapprove-member") await updateMember(button.dataset.id, { approved: false });
  if (button.dataset.action === "remove-member") await removeMember(button.dataset.id);
});

// ID 타입 오류를 해결하기 위해 기존 신청 제출 이벤트를 강제로 재정의(덮어쓰기)합니다.
if (els.equipmentForm) {
  els.equipmentForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!assertStudentCanApply()) return;

    // Number()를 씌워 글자 형태와 숫자 형태의 ID를 완벽하게 매칭시킵니다.
    const equipment = state.equipment.find(
      (item) => Number(item.id) === Number(els.equipmentSelect.value)
    );
    const quantity = Number(els.equipmentQty.value);
    const applicant = getApplicant();

    if (!equipment) {
      showToast("기자재를 선택하세요.");
      return;
    }

    // 대여 가능 수량 계산 시 오류를 방지하기 위해 안전장치를 둡니다.
    const totalCount = Number(equipment.total || equipment.total_qty || 0);
    const available = totalCount - approvedEquipmentQuantity(equipment.id);

    if (quantity < 1 || quantity > available) {
      showToast("신청 수량이 대여 가능 수량을 초과했습니다.");
      return;
    }

    if (els.equipmentReturn.value < els.equipmentStart.value) {
      showToast("반납 예정일은 대여일 이후여야 합니다.");
      return;
    }

    const { error } = await db.from("rental_requests").insert({
      type: "equipment",
      equipment_id: equipment.id,
      quantity,
      start_date: els.equipmentStart.value,
      return_date: els.equipmentReturn.value,
      purpose: els.equipmentPurpose.value.trim(),
      applicant_auth_id: session.user.id,
      applicant_name: applicant.applicant,
      student_id: applicant.studentId,
      team_name: applicant.team,
    });

    if (error) {
      showToast(error.message);
      return;
    }

    els.equipmentPurpose.value = "";
    await loadAppData();
    showToast("기자재 신청이 접수되었습니다.");
  });
}

setDefaultDates();
renderSignedOut();
renderAll();
initSupabase();
window.setInterval(renderServiceState, 60_000);
