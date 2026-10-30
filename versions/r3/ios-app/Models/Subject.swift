import Foundation
import GRDB

struct Subject: Codable, Identifiable, Hashable, FetchableRecord, PersistableRecord {
    var id: String
    
    // 計算プロパティ：UI表示などで使用
    var name: String { id }

    var displayName: String {
        return id.replacingOccurrences(of: ".json", with: "")
    }
    
    // シンプルなイニシャライザ
    init(id: String) {
        self.id = id
    }

    // --- GRDB用の設定 ---
    static let databaseTableName = "subject"

    // カラム定義を明示する
    enum Columns {
        static let id = Column("id")
    }
    
    // 単一の値（SingleValueContainer）として扱う init(from:) と encode(to:) は
    // データベース保存時にエラーの原因になるため、標準の Codable に任せるか、
    // 以下のように通常の定義にします。
}
