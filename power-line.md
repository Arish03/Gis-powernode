Act as a Senior Full-Stack Engineer and System Architect. I need to implement a major new feature into my existing GIS platform. 

Currently, the platform is focused on Plantation & Tree Analytics (React 18, FastAPI, PostgreSQL/PostGIS, Celery, NodeODM). It processes drone imagery via photogrammetry to detect trees and analyze plant health. 

I want to diversify the platform to support **Power Transmission Line Inspections**. This new project type bypasses the complex photogrammetry/AI pipeline entirely. Instead, it relies on a manual annotation workflow (similar to Label Studio) where admins upload raw drone images, draw bounding boxes to flag defects, and publish the project so clients can view the results and download a generated PDF report.

Below is the detailed specification for this new feature. Please write the necessary code (frontend, backend, database models, and utilities) to integrate this into the existing architecture.

### 1. Data Model Updates (SQLAlchemy)
Modify the existing database schema to support the new project type and its associated data:
* **Project Type Enum:** Add a `project_type` column to the `Project` model (Enum: `TREE`, `POWERLINE`). Default to `TREE` for backwards compatibility.
* **PowerlineImage Model:** Create a new table to store uploaded raw drone images.
    * Fields: `id`, `project_id` (FK), `file_path`, `filename`, `altitude`, `heading`, `date_taken`, `image_type` (Enum: RGB, Thermal).
    * *Note:* Extract EXIF data (altitude, heading, date) automatically upon upload if possible.
* **PowerlineAnnotation Model:** Create a new table for the bounding box annotations drawn on the images.
    * Fields: `id`, `image_id` (FK), `bbox_x`, `bbox_y`, `bbox_width`, `bbox_height` (stored as relative percentages or absolute pixels), `severity` (Enum: 1, 2, 3, 4, 5, POI), `issue_type` (e.g., Conductor Damage, Corrosion, Safety & Security, Miscellaneous), `remedy_action` (text), `comment` (text), `inspector_name` (string).

### 2. Backend API Updates (FastAPI)
Create new endpoints and modify existing ones to handle the Powerline workflow:
* **Project Creation:** Update the `POST /api/projects` endpoint to accept `project_type`.
* **Raw Image Upload:** Create an endpoint `POST /api/upload/{id}/powerline-images`. Unlike the tree pipeline, this does NOT trigger Celery/NodeODM. It simply saves the raw images to disk, extracts basic EXIF data, and creates `PowerlineImage` records.
* **Annotation CRUD:** Create standard REST endpoints (`GET`, `POST`, `PUT`, `DELETE`) for `PowerlineAnnotation` tied to a specific `image_id`.
* **Publishing Endpoint:** Create a `POST /api/projects/{id}/publish` endpoint. This transitions the project status to `READY`, making it visible to the assigned `CLIENT`.
* **PDF Report Generation:** Create a `GET /api/projects/{id}/report/download` endpoint. Use a library like `ReportLab` or `WeasyPrint` to dynamically generate a PDF report based on the annotations.

### 3. Frontend UI/UX Updates (React/Vite)
Integrate the Powerline workflow into the existing frontend structure:
* **Project Wizard Updates:**
    * *Step 1 (Setup):* Add a radio button or dropdown to select Project Type ("Plantation/Trees" vs. "Power Transmission Line").
    * *Step 2 (Upload):* If `POWERLINE` is selected, alter the upload dropzone to hit the new raw image upload endpoint.
    * *Step 3 (Processing):* If `POWERLINE`, bypass the NodeODM/Celery loading screen completely. Go straight to the Annotation Editor.
* **Powerline Annotation Editor (Admin/Sub-Admin):**
    * Create a new interface explicitly for annotating powerline images.
    * **Layout:** A left/bottom sidebar for navigating thumbnails of uploaded images. A main canvas displaying the selected image. A right-side properties panel.
    * **Canvas:** Allow the user to draw, move, and resize bounding boxes over the image. 
    * **Properties Panel:** When a bounding box is selected, show a form to input: Severity (Dropdown: 1, 2, 3, 4, 5, POI), Issue Type (String/Dropdown), Comment (Textarea), Remedy Action (Textarea), and Inspector Name.
    * **Header:** Add a "Publish Project" button that makes the project available to the client.
* **Client View Updates:**
    * If a client opens a `POWERLINE` project, do NOT show the MapLibre GL JS map. 
    * Instead, show a clean gallery/dashboard of the annotated images.
    * Display a summary table of issues (e.g., "Severity 5: 2 issues, Severity 4: 5 issues").
    * Provide a prominent "Download Inspection Report (PDF)" button.

### 4. PDF Report Specification
The generated PDF report must look professional and include the following structure:
* **Cover Page:** Project Name, Date, Inspector Name, and Project Type.
* **Severity Overview Table:** A count of annotations grouped by Severity (1, 2, 3, 4, 5, POI).
* **Annotation Details (Iterated per annotation):**
    * Display a cropped snippet of the bounding box area.
    * Next to the snippet, list the metadata: Annotation ID, Severity Level, Issue Type, Remedy Action, and the Inspector's Comment.
    * Below the snippet, display the full image with the bounding box overlaid so the client has spatial context. Include Image File Name, Date Taken, Altitude, and Heading.

Please provide the necessary code to implement this, separated by logical domains (e.g., SQLAlchemy Models, FastAPI Routers, React Components, PDF Utility). Ensure the code aligns with my existing role-based access control (Admin/Sub-Admin/Client) and UI styling (Tailwind CSS).