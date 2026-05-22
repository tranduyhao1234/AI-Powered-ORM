type Suggestion = {
  tone: string;
  content: string;
};

function shortPreview(text: string): string {
  const normalized = text.trim().replace(/\s+/g, " ");
  if (normalized.length <= 120) {
    return normalized;
  }
  return `${normalized.slice(0, 117)}...`;
}

export function buildFallbackSuggestions(reviewText: string): Suggestion[] {
  const preview = shortPreview(reviewText);

  return [
    {
      tone: "standard",
      content:
        `Cảm ơn bạn đã chia sẻ phản hồi. Chúng tôi đã ghi nhận ý kiến về: "${preview}". ` +
        "Đội ngũ sẽ rà soát và cải thiện trải nghiệm trong thời gian sớm nhất.",
    },
    {
      tone: "friendly",
      content:
        `Cảm ơn bạn rất nhiều vì đã ghé quán và góp ý. Về phản hồi "${preview}", ` +
        "tụi mình sẽ trao đổi với đội ngũ để phục vụ nhanh và tốt hơn ở lần tới.",
    },
    {
      tone: "problem-solving",
      content:
        `Xin lỗi vì trải nghiệm chưa trọn vẹn liên quan đến "${preview}". ` +
        "Chúng tôi đã tạo action nội bộ để xử lý ngay và sẽ theo dõi chất lượng theo ca để tránh lặp lại.",
    },
  ];
}

