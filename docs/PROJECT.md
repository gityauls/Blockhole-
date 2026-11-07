# File-BlackHole 프로젝트 개요

## 무엇을 만드는가
사용자가 파일을 웹사이트에 드롭하면 원하는 형식으로 변환하거나 용도를 바꿔 주는 웹 서비스입니다.

## 저장소
- 위치: `G:\File-BlackHole\ai-website-cloner-template`
- `origin`: https://github.com/gityauls/Blockhole-.git
- `upstream`: https://github.com/JCodesMore/ai-website-cloner-template.git (템플릿 원본)

## 기술 스택
Next.js 16, React 19, TypeScript strict, Tailwind CSS v4, shadcn/ui. 코드 규칙은 저장소의 `AGENTS.md`를 따릅니다.

## 브랜드
- 중심 자산: `public/brand/portal.gif` (닫힌 문 → 블랙홀 → 드롭 표시 → 닫힘). 평소에는 닫힌 정지 화면이고, 사용자가 다가가거나 드래그할 때만 움직인다.
- 색상: 포털 그림에서 추출해 `src/app/globals.css`의 `:root`에 정의했다.
- 글꼴: 아래 폰트 라이선스 표의 두 가지만 쓴다.
- 포털 이미지는 160px의 정수배로 표시한다.

## 폰트 라이선스
폰트를 바꿀 때는 이름이 아니라 폰트 파일 안의 라이선스 항목을 읽고, 상업적 사용과 웹 임베딩이 가능한지 확인한다. 2026-11-07에 이 PC의 설치 폰트 678종을 조사했다.

| 용도 | 폰트 | 라이선스 | 임베딩 권한 |
|---|---|---|---|
| 한글 제목·본문 | Noto Sans KR | SIL OFL 1.1 | `fsType 0`, 제한 없음 |
| 영문 로고·형식명 | NanumGothicCoding | SIL OFL 1.1 | `fsType 8`, 편집 가능 임베딩 |

- OFL 조건: 상업적 사용과 웹 배포는 가능하다. 폰트 파일만 따로 판매할 수는 없다.
- 적용은 `next/font/google`로 한다. 설치 파일(Noto 9.9MB)을 그대로 배포하지 않는다.
- 제외: Microsoft 폰트(맑은 고딕, Arial 등)는 Windows 라이선스 대상이라 웹에 실어 배포할 수 없다.
- 제외: 나눔고딕, 나눔스퀘어 등은 파일에 라이선스 문구가 없어 파일만으로 확인할 수 없다.

## 문서 구성
| 문서 | 내용 |
|---|---|
| [ROADMAP.md](ROADMAP.md) | 단계별 목표와 상태 |
| [research/altools/brief.md](research/altools/brief.md) | 알툴즈 디자인·작동 방식 분석 |
| `research/*/screenshots/` | 참조 사이트 캡처 (로컬 전용, git 제외) |

## 공개 전 원칙
1단계는 참조 사이트를 충실히 재현하지만, 외부에 공개하는 서비스는 File-BlackHole만의 것이어야 합니다.

- 알툴즈 이름, 로고, 아이콘, 일러스트, 문구, 폰트 파일 등 타사 자산은 공개 버전에 넣지 않습니다.
- 레이아웃과 작동 방식은 참고하되, 화면 구성과 시각 디자인은 공개 전에 자체 디자인으로 바꿉니다.
- 참조 사이트의 소스 코드나 번들은 가져오지 않고 직접 구현합니다.
- 사용하는 변환 라이브러리의 라이선스를 공개 전에 확인합니다.
