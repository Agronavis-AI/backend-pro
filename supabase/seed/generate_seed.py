"""Aggregates block-level Soil Health Card rows into district totals.

The source CSV currently covers Bihar, Haryana, Jharkhand, Punjab and Uttar
Pradesh. Districts outside those states fall back to the state average, and
states outside them have no estimate at all.

    python supabase/seed/generate_seed.py
"""
import csv
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
SOURCE = HERE / 'all_states.csv'
OUTPUT = HERE.parent / 'migrations' / '0009_regional_soil_seed.sql'

data = defaultdict(lambda: defaultdict(int))

with SOURCE.open() as f:
    reader = csv.DictReader(f)
    for row in reader:
        state = row['State'].title().replace('Prradesh', 'Pradesh')
        district = row['District'].title()
        key = (state, district)
        
        try:
            data[key]['n_High'] += int(row.get('n_High') or 0)
            data[key]['n_Medium'] += int(row.get('n_Medium') or 0)
            data[key]['n_Low'] += int(row.get('n_Low') or 0)
            
            data[key]['p_High'] += int(row.get('p_High') or 0)
            data[key]['p_Medium'] += int(row.get('p_Medium') or 0)
            data[key]['p_Low'] += int(row.get('p_Low') or 0)
            
            data[key]['k_High'] += int(row.get('k_High') or 0)
            data[key]['k_Medium'] += int(row.get('k_Medium') or 0)
            data[key]['k_Low'] += int(row.get('k_Low') or 0)
            
            data[key]['pH_Alkaline'] += int(row.get('pH_Alkaline') or 0)
            data[key]['pH_Acidic'] += int(row.get('pH_Acidic') or 0)
            data[key]['pH_Neutral'] += int(row.get('pH_Neutral') or 0)
            
            data[key]['OC_High'] += int(row.get('OC_High') or 0)
            data[key]['OC_Medium'] += int(row.get('OC_Medium') or 0)
            data[key]['OC_Low'] += int(row.get('OC_Low') or 0)
        except ValueError:
            continue

sql_statements = []
sql_statements.append("-- v3: Seed regional_soil_data with real data aggregated by District")
sql_statements.append("DELETE FROM public.regional_soil_data;")
sql_statements.append("INSERT INTO public.regional_soil_data")
sql_statements.append('  ("State", "District", n_high, n_medium, n_low, p_high, p_medium, p_low, k_high, k_medium, k_low, "pH_Alkaline", "pH_Acidic", "pH_Neutral", "OC_High", "OC_Medium", "OC_Low")')
sql_statements.append("VALUES")

values = []
for (state, district), counts in data.items():
    val = f"('{state}', '{district}', {counts['n_High']}, {counts['n_Medium']}, {counts['n_Low']}, {counts['p_High']}, {counts['p_Medium']}, {counts['p_Low']}, {counts['k_High']}, {counts['k_Medium']}, {counts['k_Low']}, {counts['pH_Alkaline']}, {counts['pH_Acidic']}, {counts['pH_Neutral']}, {counts['OC_High']}, {counts['OC_Medium']}, {counts['OC_Low']})"
    values.append(val)

sql_statements.append(",\n".join(values) + ";")

OUTPUT.write_text("\n".join(sql_statements) + "\n")

states = sorted({state for state, _ in data})
print(f"Generated {len(data)} district records across {len(states)} states: {', '.join(states)}")
print(f"Wrote {OUTPUT}")
