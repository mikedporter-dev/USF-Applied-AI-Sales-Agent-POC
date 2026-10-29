-- FICTIONAL sample accounts for testing. Safe to run more than once.
-- Generated from src/shared/sampleData.ts. Companies, people, and filings are
-- invented; CIKs use the 999xxxxxxx range, which the SEC has never issued.
-- Requires 0001_init.sql and 0002_target_contact_approval.sql.
--
-- To remove the sample data later, run only:
--   delete from companies where cik like '999%';
-- (signals, connections, and target contacts are removed with their company.)

begin;

delete from companies where cik like '999%';

insert into companies (cik, ticker, name, industry, index_membership, revenue_usd, employees) values
  ('9990000001', 'HLVF', 'Halverson Freight Group', 'Industrials', 'S&P 500', 18400000000, 52000),
  ('9990000002', 'CVHP', 'Corvane Health Partners', 'Health Care', 'S&P 500', 27100000000, 88000),
  ('9990000003', 'BWMF', 'Brightwater Mutual Financial', 'Financials', 'S&P MidCap 400', 4200000000, 9800),
  ('9990000004', 'PAFD', 'Pell & Ardent Foods', 'Consumer Staples', 'S&P MidCap 400', 6800000000, 21000),
  ('9990000005', 'TSLE', 'Tessaline Energy', 'Energy', 'S&P 500', 31500000000, 14500),
  ('9990000006', 'MRPR', 'Marrow Point Retail', 'Consumer Discretionary', 'S&P SmallCap 600', 1300000000, 7400),
  ('9990000007', 'QLMK', 'Quillmark Insurance Holdings', 'Financials', 'S&P 500', 22900000000, 31000),
  ('9990000008', 'OSTM', 'Ostrander Materials', 'Materials', 'S&P SmallCap 600', 900000000, 3200),
  ('9990000009', 'KBMD', 'Kestrel Bay Media', 'Communication Services', 'S&P MidCap 400', 3600000000, 6100);

insert into signals (cik, kind, summary, form, section, filed_at, source) values
  ('9990000001', 'ai_commitment', 'Commits $400M over three years to AI-driven route planning and yard automation.', '10-K', 'Item 1 Business', '2026-02-21', 'massive'),
  ('9990000001', 'leadership_change', 'Appoints first Chief Digital Officer, reporting to the CEO.', '8-K', 'Item 5.02', '2026-08-04', 'massive'),
  ('9990000001', 'ai_pilot_no_results', 'Predictive maintenance pilot at four terminals; no outcomes disclosed.', '10-Q', 'MD&A', '2026-07-30', 'edgar'),
  ('9990000001', 'ai_pilot_no_results', 'Generative AI customer-service pilot described as "early stage".', '8-K EX-99', 'Investor presentation', '2026-05-12', 'edgar'),
  ('9990000002', 'ai_commitment', 'States goal to automate 30% of prior-authorization reviews with AI by 2028.', '10-K', 'Item 1 Business', '2026-02-27', 'massive'),
  ('9990000002', 'ai_reorg', 'Consolidates analytics teams into a new Enterprise AI organization.', '8-K', 'Item 2.05', '2026-09-18', 'massive'),
  ('9990000002', 'leadership_change', 'Names new Chief Data & Analytics Officer (Form 3 filed).', 'Form 3', null, '2026-09-22', 'massive'),
  ('9990000002', 'ai_pilot_no_results', 'Clinical documentation AI in pilot across two regions; results not reported.', '10-Q', 'MD&A', '2026-08-06', 'edgar'),
  ('9990000003', 'ai_commitment', 'Risk factors cite AI adoption by competitors as a threat to deposit growth.', '10-K', 'Item 1A Risk Factors', '2026-03-01', 'massive'),
  ('9990000003', 'acquisition', 'Completes acquisition of a regional wealth manager.', '8-K', 'Item 2.01', '2026-06-30', 'massive'),
  ('9990000003', 'ai_pilot_no_results', 'Earnings release mentions AI underwriting pilot without metrics.', '8-K EX-99', 'Earnings release', '2026-07-22', 'edgar'),
  ('9990000004', 'restructuring', 'Announces restructuring of North American supply chain.', '8-K', 'Item 2.05', '2026-04-15', 'massive'),
  ('9990000004', 'ai_commitment', 'MD&A cites AI demand forecasting as a 2027 margin lever.', '10-Q', 'MD&A', '2026-08-12', 'edgar'),
  ('9990000005', 'ai_commitment', 'Describes AI-enabled reservoir modeling program in Business section.', '10-K', 'Item 1 Business', '2026-02-18', 'massive'),
  ('9990000006', 'leadership_change', 'CEO departs; interim CEO named from the board.', '8-K', 'Item 5.02', '2026-09-03', 'massive'),
  ('9990000006', 'ai_pilot_no_results', 'Personalization pilot referenced in investor day deck; no results.', '8-K EX-99', 'Investor presentation', '2026-06-10', 'edgar'),
  ('9990000007', 'ai_commitment', 'Commits to AI claims triage across all personal lines.', '10-K', 'Item 1 Business', '2026-02-25', 'massive'),
  ('9990000007', 'ai_scaled_results', 'Reports AI claims triage live on 70% of claims, cutting cycle time 35%.', '8-K EX-99', 'Earnings release', '2026-07-28', 'edgar'),
  ('9990000008', 'ai_commitment', 'Older 10-K language on "exploring AI"; outside the 12-month window.', '10-K', 'Item 1 Business', '2025-03-05', 'massive'),
  ('9990000009', 'ai_reorg', 'Newsroom reorganization to adopt generative AI tooling.', '8-K', 'Item 2.05', '2026-08-20', 'massive');

insert into connections (cik, name, title, seniority) values
  ('9990000001', 'Dana Whitcomb', 'VP, Network Operations', 'VP'),
  ('9990000001', 'Luis Ortega', 'Senior Manager, Procurement', 'Manager'),
  ('9990000002', 'Marcus Bell', 'Director, Revenue Cycle', 'Director'),
  ('9990000003', 'Grace Liu', 'SVP, Commercial Banking', 'VP'),
  ('9990000003', 'Tom Hadley', 'Manager, Treasury Services', 'Manager'),
  ('9990000004', 'Nadia Shah', 'Director, Category Strategy', 'Director'),
  ('9990000005', 'Ray Dominguez', 'Manager, Field Engineering', 'Manager'),
  ('9990000006', 'Chloe Abrams', 'VP, Merchandising', 'VP'),
  ('9990000007', 'Henry Vu', 'Chief Actuary', 'C-Suite'),
  ('9990000008', 'Ivy Chen', 'Plant Manager', 'Manager');

-- Every contact starts as pending approval, with no email.
insert into target_contacts (cik, name, title, ladder_rank) values
  ('9990000001', 'Priya Raman', 'Chief Digital Officer', 3),
  ('9990000002', 'Elena Fischer', 'Chief Data & Analytics Officer', 1),
  ('9990000003', 'Owen Park', 'Chief Information Officer', 2),
  ('9990000004', 'Ben Kowalski', 'Chief Technology Officer', 2),
  ('9990000006', 'Sam Okafor', 'Chief Information Officer', 2),
  ('9990000007', 'Julia Moreno', 'Chief AI Officer', 0);

commit;
