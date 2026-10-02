# 흐름도 출처와 표현 범위

2026-10-02 확인. 로고는 구현에 사용한 기술을 식별하기 위한 자료입니다. 각 권리자와의 제휴·후원·공식 인증을 의미하지 않습니다. 프로젝트의 MIT 라이선스가 제3자 로고·상표를 재허가하는 것은 아닙니다.

| 카드 | 원본 출처 | 사용한 파일과 확인 범위 |
| --- | --- | --- |
| React | [공식 문서 저장소](https://github.com/reactjs/react.dev/tree/8c68ae8d2410abe59f351195780c6f8ea9f50904/public/images/brand) | logo_dark.svg. 공식 배포 파일의 형태·색상·비율 유지 |
| Express | [공식 사이트 저장소](https://github.com/expressjs/expressjs.com/tree/c936b6310349ca92cf59493d4038dd663704f1a1/public/images/logos) | logo-express-black.svg. 워드마크 비율 유지 |
| MCP | [공식 명세 저장소](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/3098fe94caa1b9e0afaaa6d30e040b61d5802471/docs/favicon.svg) | 공식 favicon.svg. SDK Client와 Server를 한 카드로 요약 |
| Node.js | [공식 브랜드 파일](https://nodejs.org/static/logos/nodejsHex.svg) · [브랜드 안내](https://nodejs.org/en/about/branding) | nodejsHex.svg. Node.js HTTP 모듈로 만든 점검 대상 샘플 서비스 표시 |
| PGlite | [공식 문서 저장소](https://github.com/electric-sql/pglite/blob/ae182ff8bd5ba4acb887d6c925d607a1498aa0b5/docs/public/img/brand/icon.svg) | icon.svg. 노란색 원본을 유지하고 카드 안쪽에 어두운 배경 배치 |
| OpenAI API | 이 프로젝트에서 작성한 일반 API 아이콘 | **OpenAI 공식 로고가 아닙니다.** 선택 API 연동을 뜻하는 코드 괄호 아이콘이며 Blossom을 모방하지 않았습니다. |

Node.js는 OpenJS Foundation의 등록상표이며 Express 관련 상표는 해당 권리자에게 속합니다. [OpenJS 상표 정책](https://trademark-policy.openjsf.org/)을 확인했습니다. React·MCP·PGlite의 로고 및 OpenAI 명칭도 각 권리자에게 속합니다. 소프트웨어 라이선스와 상표 사용 조건을 같은 것으로 취급하지 않습니다.

원본 URL·Git revision·파일별 SHA-256과 사용 설명은 [assets.json](assets.json)에 보존했습니다. SVG를 만들 때 색상과 도형을 수정하지 않고 비율을 유지했으며, 서로 다른 SVG의 내부 ID만 충돌하지 않도록 접두사를 붙였습니다. 외부 이미지·스크립트·이벤트·외부 CSS를 포함하지 않는 독립 SVG입니다.

## 화살표가 의미하는 것

- 가운데 실선: React 요청 → Express API → MCP 점검 → Node.js HTTP 샘플 → PGlite의 생산실적 조회.
- MCP에서 DB로 이어지는 아래 실선: SQL 직접 점검과 저장된 가이드 검색.
- Express에서 DB로 이어지는 가장 아래 실선: 장애·점검 실행·해결 가이드 저장.
- 위 점선: 선택 모드의 OpenAI API 분석. 모델이 도구를 선택하면 **서버가** MCP를 호출합니다. OpenAI가 MCP 서버에 직접 연결하는 구조가 아닙니다.

기본 규칙 점검은 실제 로컬 HTTP·SQL·MCP로 검증했습니다. 외부 OpenAI 호출은 아직 미검증입니다. PGlite는 임베디드 PostgreSQL이며 별도 DB 서버 배포를 뜻하지 않습니다. Express API와 MCP Client·Server, 샘플 HTTP 리스너는 같은 Node.js 프로세스에 있습니다.

편집 가능한 [그래프](flow.json), [SVG](technology-flow.svg), [PNG](technology-flow.png), [로컬 렌더러](render_flow.py)를 함께 보존했습니다. 로고 카드에는 기술명만 두고, 위 관계 설명은 그림 밖에 둡니다.
