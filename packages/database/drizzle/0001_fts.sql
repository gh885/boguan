-- 检索索引。Drizzle 不支持虚拟表，所以手写。
--
-- rowid 就是 posts.id（写入时用 `insert into posts_fts(rowid, ...)` 指定）。
-- content = '' 表示表里不保存正文列，只保存分词后的 term 与位置：列值取回来是 NULL，
-- snippet() / highlight() 也不可用——搜索只展示 posts.summary，不给命中上下文（见 §7）。
-- contentless_delete = 1 让删除可以按 rowid 直接 delete，否则要提供原始列值
-- （需要 SQLite >= 3.43，better-sqlite3 自带的版本满足）。
-- tokenize = 'unicode61'：入库前已由 @node-rs/jieba 用空格切开，这里只按空格与标点分词。
CREATE VIRTUAL TABLE `posts_fts` USING fts5(
	`title_tokens`,
	`body_tokens`,
	tokenize = 'unicode61 remove_diacritics 2',
	content = '',
	contentless_delete = 1
);
