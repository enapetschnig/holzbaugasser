import MatrixBerichtForm from "@/components/MatrixBerichtForm";

export default function WerkBerichtTimeTracking() {
  return (
    <MatrixBerichtForm
      berichtTyp="werk"
      pageTitle="Leistungsbericht Werk"
      taetigkeitPrefix="Werk"
    />
  );
}
