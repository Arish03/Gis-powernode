import ProjectWizard from './ProjectWizard';

export default function PlantationWizard() {
  // We pass a prop or use a different default in a modified ProjectWizard
  // For now, let's just use the existing one but we could enhance it later
  // to skip the type selection step.
  return <ProjectWizard defaultType="TREE" />;
}
