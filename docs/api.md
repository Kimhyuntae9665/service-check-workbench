# REST API와 저장 구조

서버 기본 주소: http://127.0.0.1:4310. 모든 POST는 application/json을 사용합니다. API 오류는 {error, code} 형태입니다. 서버는 loopback에 바인딩하며 다른 Host·Origin과 cross-site 변경 요청을 거부합니다. 인증을 대신하는 범용 보안 설계가 아니므로 외부에 그대로 노출하지 않습니다.

| 메서드 | 경로                      | 목적                                                                               |
| ------ | ------------------------- | ---------------------------------------------------------------------------------- |
| GET    | /api/health               | 서버·MCP 연결 확인                                                                 |
| GET    | /api/workspace            | 서비스·장애·가이드·실측 집계·모드                                                  |
| POST   | /api/incidents            | title(2–120), symptom(5–2000), serviceId=production-api, priority=medium 또는 high |
| GET    | /api/incidents/:id        | 상세·모든 실행·저장된 가이드                                                       |
| POST   | /api/incidents/:id/runs   | kind=diagnose 또는 recheck. 완료된 Run 반환                                        |
| POST   | /api/incidents/:id/guides | 선택 입력 resolution(5–2000). 현재 환경의 최근 재검증 통과가 필요                  |
| GET    | /api/guides/:id           | 가이드 상세                                                                        |
| POST   | /api/lab/scenario         | scenario=healthy, service_down, wrong_port, db_auth                                |
| POST   | /api/runtime              | mode=demo 또는 live. API 설정 없는 live 요청은 거부                                |

## 테이블 관계

- services: 서비스 기본 정보
- incidents: 접수 내용·상태·최근 실행 ID
- runs: incident_id FK, 점검 결과 JSONB, 환경 revision, 실제 실패 여부
- guides: incident_id FK + UNIQUE, 실패 원본·재검증·해결 기록
- production_records: 예시 생산실적의 실제 업무 SQL 조회 대상

상세 근거는 JSONB에 보존하고 장애별 이력 조회에 필요한 incident_id는 관계 컬럼으로 둡니다. runs(incident_id, (data->>'startedAt')) 인덱스로 조회 경로를 보완했습니다. SQL은 매개변수로 실행합니다. 스키마와 쿼리는 server/storage.ts에서 확인할 수 있습니다.

현재는 작은 로컬 샘플입니다. 전체 목록 페이지네이션, 스키마 버전 마이그레이션, JSONB 검색 전용 인덱스, 여러 사용자 권한은 구현 범위 밖입니다.
