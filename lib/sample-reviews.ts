import type { GooglePlaceReview } from "@/lib/google-places";

export function buildSampleReviews(placeId: string): GooglePlaceReview[] {
  const now = Math.floor(Date.now() / 1000);

  return [
    {
      author_name: "Anh Minh",
      rating: 5,
      text: `Đồ ăn ngon, phục vụ nhanh. Sẽ quay lại (sample for ${placeId}).`,
      time: now - 60 * 30,
    },
    {
      author_name: "Chị Lan",
      rating: 4,
      text: "Quán đông nhưng nhân viên hỗ trợ ổn, món lên hơi chậm.",
      time: now - 60 * 60 * 3,
    },
    {
      author_name: "Tuấn Trần",
      rating: 3,
      text: "Không gian ổn, cần cải thiện vệ sinh bàn ghế vào giờ cao điểm.",
      time: now - 60 * 60 * 8,
    },
    {
      author_name: "Hà Phạm",
      rating: 5,
      text: "Giá hợp lý, món ăn vừa miệng, giữ xe thuận tiện.",
      time: now - 60 * 60 * 16,
    },
    {
      author_name: "Ngọc Vũ",
      rating: 2,
      text: "Phục vụ chưa nhiệt tình, mong quán cải thiện thái độ nhân viên.",
      time: now - 60 * 60 * 24,
    },
  ];
}

