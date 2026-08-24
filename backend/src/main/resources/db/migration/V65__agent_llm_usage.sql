-- Agent가 이 조직을 대신해 모델을 부른 기록. 하루치 사용량의 유일한 근거.
--
-- 왜 카운터 행이 아니라 호출별 행인가: 카운터는 "오늘 몇 번"만 답하고, quota를 넘긴 순간
-- 무엇이 그 예산을 썼는지 아무도 재구성할 수 없다. 한 조직이 하루에 만드는 행은 수백 개
-- 규모이고(호출 하나당 하나), 그 대가로 "planner가 몇 번, judge가 몇 번, 어느 run에서"가
-- 남는다. 예산이 왜 사라졌는지 설명할 수 없는 예산은 다음 날 그냥 상향되기 마련이다.
--
-- run_id는 NULL을 허용한다. 초안(draft) 같은 단발 호출은 run에 속하지 않으며, 속한 척하는
-- 것보다 비어 있는 편이 정직하다. 하루 run 수는 그래서 count(*)가 아니라
-- count(distinct run_id)로 센다.
--
-- 여기에는 goal 문장도, 응답도, 어떤 콘텐츠도 남기지 않는다. 사용량은 사용량이고,
-- 이 테이블은 그 이상을 알 필요가 없다.
create table if not exists agent_llm_usage (
    id          uuid primary key,
    org_id      uuid not null references organizations(id),
    -- KST 달력 날짜. 하루의 경계는 판매자가 사는 하루의 경계여야 한다.
    usage_date  date not null,
    -- PLAN | JUDGE | DRAFT
    kind        varchar(16) not null,
    run_id      varchar(200),
    created_at  timestamptz not null,
    updated_at  timestamptz not null
);

create index if not exists idx_agent_llm_usage_org_day on agent_llm_usage (org_id, usage_date);
