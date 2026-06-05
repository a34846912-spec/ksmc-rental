# 경성대학교 미디어콘텐츠학과 기자재 · 강의실 대여 앱

Vercel + Supabase 조합으로 운영할 수 있는 웹 앱입니다. 학생은 회원가입 후 관리자 승인을 받아 기자재/강의실 대여를 신청하고, 관리자는 신청 승인/반려/반납과 회원 승인을 처리합니다.

## 기술 구성

- Frontend: HTML/CSS/JavaScript
- Auth/Database: Supabase
- Hosting: Vercel
- Config: Vercel 환경변수 또는 로컬 `config.js`

## Supabase 설정

1. Supabase에서 새 프로젝트를 생성합니다.
2. `SQL Editor`에서 [supabase/schema.sql](/Users/markhwang/Documents/ksmc_rental/supabase/schema.sql)의 전체 SQL을 실행합니다.
3. `Authentication > Providers > Email`에서 Email 로그인을 활성화합니다.
4. 첫 관리자 계정을 앱에서 회원가입합니다.
5. Supabase SQL Editor에서 아래 쿼리로 첫 관리자 권한을 부여합니다.

```sql
update public.members
set role = 'admin', approved = true
where email = '관리자이메일@example.com';
```

## 로컬 실행

`config.example.js`를 복사해 `config.local.js`를 만들고 Supabase 값을 넣습니다. `config.local.js`는 Git에 올라가지 않습니다.

```js
window.KSMC_SUPABASE_CONFIG = {
  supabaseUrl: "https://YOUR_PROJECT_REF.supabase.co",
  supabaseAnonKey: "YOUR_SUPABASE_ANON_KEY",
};
```

그 다음 로컬 서버를 실행합니다.

```bash
python3 -m http.server 8080
```

## Vercel 배포

1. 이 폴더를 GitHub 저장소에 올립니다.
2. Vercel에서 해당 저장소를 Import 합니다.
3. Vercel 프로젝트의 `Settings > Environment Variables`에 아래 값을 추가합니다.

```text
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
```

4. 배포 후 Supabase `Authentication > URL Configuration`에서 Vercel 배포 주소를 Site URL에 등록합니다.

## 운영 흐름

- 학생: 회원가입 -> 관리자 승인 대기 -> 승인 후 신청 가능
- 관리자: 관리자 화면 -> 회원 승인 -> 신청 승인/반려/반납 처리
- 신청 제한: 평일 09:00-16:00에만 신청 가능
- 현황 확인: 로그인한 사용자는 예약 현황을 확인할 수 있습니다.

## 다음 확장 후보

- 기자재/강의실 추가·수정 화면
- 신청 마감 시간을 Supabase Edge Function에서 서버 기준으로 검증
- 이메일 또는 카카오 알림
- CSV 업로드 기반 재학생 명단 일괄 등록
