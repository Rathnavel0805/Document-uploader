-- Database and table setup for Document Uploader

CREATE DATABASE IF NOT EXISTS document_uploader;
USE document_uploader;

-- 1. Table for registered individuals
CREATE TABLE IF NOT EXISTS people (
  register_no VARCHAR(50) NOT NULL PRIMARY KEY,
  person_name VARCHAR(100) NOT NULL,
  registered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Table for uploaded photos and signatures
CREATE TABLE IF NOT EXISTS documents (
  id INT AUTO_INCREMENT PRIMARY KEY,
  register_no VARCHAR(50) NOT NULL,
  doc_type ENUM('photo', 'signature') NOT NULL,
  original_name VARCHAR(255),
  original_size INT,
  compressed_size INT,
  file_data MEDIUMBLOB NOT NULL,
  uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_person_doc (register_no, doc_type),
  CONSTRAINT fk_documents_people FOREIGN KEY (register_no) REFERENCES people (register_no) ON DELETE CASCADE
);
