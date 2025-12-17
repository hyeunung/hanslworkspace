import pandas as pd
import os
from openai import OpenAI
import sys

# Define file path
file_path = "sample-data/24_25_SOCKET/2024/H24-001_VR-L(R43B)_C50_UPDOWN_Flexible_Auto_PTM3.2(ADC)_COMMON2.0_6L_0x0320_V2.0/H24-001_VR-L(R43B)_C50_UPDOWN_FLEXIBLE_AUTO_PTM3.2(ADC)_COMMON2.0_6L_0X0320_V2.0(2401).xlsx"

def main():
    # 1. Read Excel File
    print(f"Reading file: {file_path}")
    try:
        df = pd.read_excel(file_path)
    except Exception as e:
        print(f"Error reading file: {e}")
        return

    # 2. Find '품명' column
    target_col = None
    for col in df.columns:
        if "품명" in str(col):
            target_col = col
            break
    
    if not target_col:
        # Try looking in the first few rows if header is not at row 0
        # Reload with header=None and search
        print("Column '품명' not found in header. searching first 10 rows...")
        df_raw = pd.read_excel(file_path, header=None, nrows=10)
        found = False
        for r_idx, row in df_raw.iterrows():
            for c_idx, val in enumerate(row):
                if isinstance(val, str) and "품명" in val:
                    print(f"Found '품명' at row {r_idx}, col {c_idx}")
                    # Reload with correct header
                    df = pd.read_excel(file_path, header=r_idx)
                    target_col = df.columns[c_idx]
                    found = True
                    break
            if found: break
        
        if not target_col:
            print("Could not find '품명' column.")
            print("Columns found:", df.columns.tolist())
            return

    print(f"Using column: {target_col}")
    
    # 3. Extract unique values
    products = df[target_col].dropna().unique().tolist()
    print(f"Found {len(products)} unique entries.")
    
    # Limit to avoid huge tokens if too many
    products_str = ", ".join([str(p) for p in products[:500]]) 

    # 4. Call OpenAI
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        print("Error: OPENAI_API_KEY not found in environment variables.")
        # Fallback: just print them
        print("Listing products directly:")
        for p in products:
            print(f"- {p}")
        return

    print("Calling OpenAI to format the list...")
    client = OpenAI(api_key=api_key)
    
    prompt = f"""
    아래는 엑셀 파일에서 추출한 '품명' 목록입니다.
    이 목록을 정리해서 어떤 제품들이 포함되어 있는지 보기 좋게 요약 및 나열해 주세요.
    중복되거나 비슷한 항목은 그룹화해서 보여주세요.
    한국어로 답변해 주세요.

    목록:
    {products_str}
    """

    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini", # Use a cheaper/faster model
            messages=[
                {"role": "system", "content": "You are a helpful assistant."},
                {"role": "user", "content": prompt}
            ]
        )
        print("\n=== OpenAI Analysis Report ===\n")
        print(response.choices[0].message.content)
        
    except Exception as e:
        print(f"Error calling OpenAI: {e}")
        print("Raw list:")
        print(products_str)

if __name__ == "__main__":
    main()




















