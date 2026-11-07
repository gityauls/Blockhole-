# File-BlackHole 프로젝트 개요

## 무엇을 만드는가
사용자가 파일을 웹사이트에 드롭하면 원하는 형식으로 변환하거나 용도를 바꿔 주는 웹 서비스입니다.

## 저장소
- 위치: `G:\File-BlackHole\ai-website-cloner-template`
- `origin`: https://github.com/gityauls/Blockhole-.git
- `upstream`: https://github.com/JCodesMore/ai-website-cloner-template.git (템플릿 원본)

## 기술 스택
Next.js 16, React 19, TypeScript strict, Tailwind CSS v4, shadcn/ui. 코드 규칙은 저장소의 `AGENTS.md`를 따릅니다.

변환 라이브러리: pdf-lib(MIT), pdfjs-dist(Apache-2.0), fflate(MIT), docx(MIT), pptxgenjs(MIT). 모두 브라우저에서 동작하며 파일을 서버로 보내지 않습니다.

PDF → Office 변환 방식과 한계:
- Word: 글자 위치로 문단을 복원한다. 글자가 없는 페이지는 이미지로 넣는다. 글자가 있는 페이지의 그림과 표 선은 옮기지 않는다.
- Excel: 글자 왼쪽 위치로 칸을 나눈다. 페이지마다 시트 하나를 만든다. 병합 셀과 선은 복원하지 않는다.
- PPT: 글자를 뺀 페이지 이미지를 배경에 깔고, 줄마다 수정 가능한 글상자를 얹는다. 모든 슬라이드는 첫 페이지 크기를 따른다.
- 공통: 2단 문서는 가운데 빈 띠를 찾아 왼쪽 단부터 읽는다. 3단 이상은 처리하지 않는다. 스캔 PDF에는 OCR을 하지 않는다.

## 브랜드
- 중심 자산: `public/brand/portal.gif` (닫힌 문 → 블랙홀 → 드롭 표시 → 닫힘). 평소에는 닫힌 정지 화면이고, 사용자가 다가가거나 드래그할 때만 움직인다.
- 디자인: 밝은 바탕에 얇은 선과 둥근 모서리를 쓰는 깔끔한 형태다. 강조색은 포털 그림의 인디고이고 `src/app/globals.css`의 `:root`에 정의했다.
- 글꼴: 아래 폰트 라이선스 표에서 사용 중인 세 가지만 쓴다.
- 포털 이미지는 160px의 정수배로 표시한다.

## 폰트 라이선스
폰트를 바꿀 때는 이름이 아니라 배포 파일의 라이선스 원문을 읽고, 상업적 사용과 웹 임베딩이 가능한지 확인한다. 후보 원본은 `G:\File-BlackHole\use-font`에 있고, 아래 6종 모두 라이선스 원문에서 SIL OFL 1.1을 확인했다.

| 폰트 | 용도 | 적용 |
|---|---|---|
| Pretendard | 한글 제목·본문 | 사용 중, `src/app/fonts/pretendard`의 공식 분할 파일 |
| Inter | 영문·숫자 | 사용 중, `next/font/google` |
| Manrope | 로고, 파일 형식명 | 사용 중, `next/font/google` |
| SUIT | 후보 | 미사용 |
| Noto Sans KR | 후보 | 미사용 |
| Atkinson Hyperlegible Next | 후보 | 미사용 |

- OFL 조건: 상업적 사용과 웹 배포는 가능하다. 폰트 파일만 따로 판매할 수는 없고, 라이선스 고지를 유지해야 한다.
- Pretendard는 예약 글꼴명이 있어 파일을 수정해 배포하면 이름을 바꿔야 한다. 공식 파일을 수정하지 않고 쓴다.
- 제외: Microsoft 폰트(맑은 고딕, Arial 등)는 Windows 라이선스 대상이라 웹에 실어 배포할 수 없다.

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
