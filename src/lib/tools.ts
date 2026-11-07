export type Tool = {
  name: string;
  description: string;
  available: boolean;
};

export const TOOLS: Tool[] = [
  { name: "이미지 변환", description: "JPG, PNG, WEBP, BMP를 서로 바꾸기", available: true },
  { name: "PDF 병합과 분할", description: "PDF를 합치거나 필요한 페이지만 나누기", available: true },
  { name: "이미지를 PDF로", description: "여러 이미지를 PDF 하나로 묶기", available: true },
  { name: "PDF를 이미지와 텍스트로", description: "페이지를 JPG로 저장하거나 글자만 뽑기", available: true },
  { name: "PDF를 Office 문서로", description: "PDF를 Word, Excel, PPT로 바꾸기", available: false },
  { name: "압축 파일을 ZIP으로", description: "ALZ, EGG, RAR, 7z를 ZIP으로 바꾸기", available: false },
];
